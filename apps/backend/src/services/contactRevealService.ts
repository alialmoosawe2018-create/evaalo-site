/**
 * Head Hunter contact reveal — field-level idempotency, atomic Mongo transaction,
 * direct credit consumption (no reservation hop).
 */

import mongoose, { type ClientSession } from 'mongoose';
import HeadHunterContactReveal, {
    CONTACT_REVEAL_FIELDS,
    type ContactRevealField,
    type IHeadHunterContactReveal,
} from '../models/HeadHunterContactReveal.js';
import CreditBalance from '../models/CreditBalance.js';
import CreditLedger from '../models/CreditLedger.js';
import OrgPlanState, { type IOrgPlanState } from '../models/OrgPlanState.js';
import {
    creditCostMicro,
    featureForUsageType,
    getMonthlyCredits,
    planHasFeature,
} from './billingEngine.js';
import { isBillingActive } from './billingRuntimeService.js';
import { dispatchAuditOutbox, enqueueAuditOutbox } from './auditOutboxService.js';
import {
    MICRO_PER_CREDIT,
    type BillingPlanId,
    type BillingCycle,
    type SubscriptionStatus,
} from '../types/billing.js';

export type ContactRevealResult =
    | {
          ok: true;
          candidateKey: string;
          alreadyRevealed: boolean;
          creditsCharged: number;
          newlyRevealedFields: ContactRevealField[];
          revealedFields: ContactRevealField[];
          balanceAfterMicro: number;
          creditsRemaining: number;
          auditOutboxId?: string;
      }
    | {
          ok: false;
          code: string;
          message: string;
      };

function isDuplicateKeyError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: number }).code === 11000
    );
}

function isTransactionUnsupported(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { code?: number; codeName?: string; message?: string };
    if (e.code === 20 || e.codeName === 'IllegalOperation') return true;
    const msg = String(e.message || '');
    return /Transaction numbers are only allowed|replica set|mongos|not supported/i.test(msg);
}

function buildPlanSnapshot(state: IOrgPlanState | null): {
    planId: BillingPlanId | null;
    cycle: BillingCycle | null;
    subscriptionStatus: SubscriptionStatus | null;
    monthlyCredits: number | null;
} {
    if (!state) {
        return { planId: null, cycle: null, subscriptionStatus: null, monthlyCredits: null };
    }
    return {
        planId: state.planId,
        cycle: state.billingCycle,
        subscriptionStatus: state.subscriptionStatus,
        monthlyCredits: getMonthlyCredits(state.planId),
    };
}

/** @internal exported for route + frontend parity tests */
export function normalizeRevealKeyPart(v: unknown): string {
    if (typeof v !== 'string') return '';
    return v.trim().toLowerCase().replace(/\s+/g, '');
}

/** Stable candidate identity — must match frontend candidateRevealKey(). */
export function resolveCandidateKey(body: Record<string, unknown>): string {
    const linkedin = normalizeRevealKeyPart(body.linkedin ?? body.linkedin_url);
    if (linkedin) return `li:${linkedin.replace(/^https?:\/\//, '').replace(/\/+$/, '').slice(0, 160)}`;
    const email = normalizeRevealKeyPart(body.email);
    if (email) return `em:${email.slice(0, 160)}`;
    const phone = normalizeRevealKeyPart(body.phone).replace(/[^\d+]/g, '');
    if (phone) return `ph:${phone.slice(0, 40)}`;
    const explicit =
        typeof body.candidateKey === 'string' && body.candidateKey.trim()
            ? body.candidateKey.trim()
            : typeof body.candidateId === 'string' && body.candidateId.trim()
              ? body.candidateId.trim()
              : '';
    return explicit ? `id:${explicit.slice(0, 160)}` : '';
}

export function parseAvailableContactFields(body: Record<string, unknown>): ContactRevealField[] {
    const fields: ContactRevealField[] = [];
    if (normalizeRevealKeyPart(body.phone)) fields.push('phone');
    if (normalizeRevealKeyPart(body.email)) fields.push('email');
    if (normalizeRevealKeyPart(body.linkedin ?? body.linkedin_url)) fields.push('linkedin');
    return fields;
}

export function fieldIdempotencyKey(
    organizationId: string,
    candidateKey: string,
    field: ContactRevealField,
): string {
    return `contact-reveal:${organizationId}:${candidateKey}:${field}`;
}

/** Legacy rows (pre field-level) — treat as fully revealed. */
export function isLegacyFullReveal(doc: IHeadHunterContactReveal | null): boolean {
    if (!doc) return false;
    if (doc.pieces <= 0 && doc.creditsCharged <= 0) return false;
    const rf = doc.revealedFields;
    if (!rf) return true;
    return !CONTACT_REVEAL_FIELDS.some((f) => rf[f]?.idempotencyKey);
}

export function listRevealedFieldsFromDoc(
    doc: IHeadHunterContactReveal,
    availableFields?: ContactRevealField[],
): ContactRevealField[] {
    if (isLegacyFullReveal(doc)) {
        return availableFields?.length ? availableFields : [...CONTACT_REVEAL_FIELDS];
    }
    return CONTACT_REVEAL_FIELDS.filter((f) => Boolean(doc.revealedFields?.[f]?.idempotencyKey));
}

function unrevealedFields(
    doc: IHeadHunterContactReveal | null,
    available: ContactRevealField[],
): ContactRevealField[] {
    if (!doc) return available;
    if (isLegacyFullReveal(doc)) return [];
    return available.filter((f) => !doc.revealedFields?.[f]?.idempotencyKey);
}

function microToWholeCredits(micro: number): number {
    return Math.floor(Math.max(0, micro) / MICRO_PER_CREDIT);
}

type SettleInput = {
    organizationId: string;
    candidateKey: string;
    fieldsToCharge: ContactRevealField[];
    availableFields: ContactRevealField[];
    clerkUserId?: string;
    auditPayload: {
        actorClerkUserId?: string;
        actorEmail?: string;
        metadata?: Record<string, unknown>;
        ip?: string;
        userAgent?: string;
    };
    planSnapshot: ReturnType<typeof buildPlanSnapshot>;
};

type SettleResult =
    | {
          ok: true;
          creditsCharged: number;
          newlyRevealedFields: ContactRevealField[];
          revealedFields: ContactRevealField[];
          balanceAfterMicro: number;
          auditOutboxId: string;
      }
    | { ok: false; code: string; message: string };

async function settleContactReveal(input: SettleInput, session?: ClientSession): Promise<SettleResult> {
    const opts = session ? { session } : {};
    const {
        organizationId,
        candidateKey,
        fieldsToCharge,
        availableFields,
        clerkUserId,
        auditPayload,
        planSnapshot,
    } = input;

    if (fieldsToCharge.length === 0) {
        const existing = await HeadHunterContactReveal.findOne({ organizationId, candidateKey })
            .session(session ?? null)
            .exec();
        const balanceMicro =
            (await CreditBalance.findOne({ organizationId }).session(session ?? null).exec())?.balanceMicro ??
            0;
        return {
            ok: true,
            creditsCharged: 0,
            newlyRevealedFields: [],
            revealedFields: existing ? listRevealedFieldsFromDoc(existing, availableFields) : [],
            balanceAfterMicro: balanceMicro,
            auditOutboxId: '',
        };
    }

    const costMicroPerField = creditCostMicro('CONTACT_REVEAL', 1);

    const balanceDoc = await CreditBalance.findOne({ organizationId }).session(session ?? null).exec();
    if (!balanceDoc) {
        return {
            ok: false,
            code: 'ORG_NOT_FOUND',
            message: 'Credit balance not initialized for this organization',
        };
    }

    let runningBalance = balanceDoc.balanceMicro;
    const now = new Date();

    const fieldsNeedingLedger: ContactRevealField[] = [];
    for (const field of fieldsToCharge) {
        const idempotencyKey = fieldIdempotencyKey(organizationId, candidateKey, field);
        const dup = await CreditLedger.findOne({ organizationId, idempotencyKey })
            .session(session ?? null)
            .exec();
        if (!dup) {
            fieldsNeedingLedger.push(field);
        }
    }

    if (fieldsNeedingLedger.length === 0) {
        const existing = await HeadHunterContactReveal.findOne({ organizationId, candidateKey })
            .session(session ?? null)
            .exec();
        return {
            ok: true,
            creditsCharged: 0,
            newlyRevealedFields: [],
            revealedFields: existing ? listRevealedFieldsFromDoc(existing, availableFields) : [],
            balanceAfterMicro: balanceDoc.balanceMicro,
            auditOutboxId: '',
        };
    }

    const chargeMicro = costMicroPerField * fieldsNeedingLedger.length;
    if (balanceDoc.balanceMicro < chargeMicro) {
        return {
            ok: false,
            code: 'INSUFFICIENT_CREDITS',
            message: 'Insufficient credits',
        };
    }

    // الخصم المشروط أولاً ثم صفوف الـ ledger:
    // داخل transaction الترتيب غير مهم (abort يلغي كل الكتابات)، أما في مسار
    // الـ fallback بلا session فكان الترتيب القديم (ledger ثم خصم) يترك صفوف
    // ledger بلا خصم عند رصيد غير كافٍ. الآن الخصم أولاً، وأي فشل لاحق في
    // كتابة الـ ledger يُعوَّض بحذف الصفوف المُنشأة وإرجاع الرصيد كاملاً.
    const updatedBalance = await CreditBalance.findOneAndUpdate(
        { organizationId, balanceMicro: { $gte: chargeMicro } },
        { $inc: { balanceMicro: -chargeMicro } },
        { new: true, session },
    ).exec();

    if (!updatedBalance) {
        return {
            ok: false,
            code: 'INSUFFICIENT_CREDITS',
            message: 'Insufficient credits',
        };
    }

    runningBalance = updatedBalance.balanceMicro + chargeMicro;
    const createdLedgerKeys: string[] = [];
    try {
        for (const field of fieldsNeedingLedger) {
            const idempotencyKey = fieldIdempotencyKey(organizationId, candidateKey, field);

            const balanceBeforeMicro = runningBalance;
            runningBalance -= costMicroPerField;
            const balanceAfterMicro = runningBalance;

            await CreditLedger.create(
                [
                    {
                        organizationId,
                        usageType: 'CONTACT_REVEAL',
                        amountMicro: -costMicroPerField,
                        balanceBeforeMicro,
                        balanceAfterMicro,
                        units: 1,
                        source: 'contact_reveal',
                        sourceId: candidateKey,
                        idempotencyKey,
                        metadata: {
                            candidateKey,
                            field,
                            planSnapshot,
                        },
                    },
                ],
                opts,
            );
            createdLedgerKeys.push(idempotencyKey);
        }
    } catch (ledgerErr) {
        if (!session) {
            if (createdLedgerKeys.length > 0) {
                await CreditLedger.deleteMany({
                    organizationId,
                    idempotencyKey: { $in: createdLedgerKeys },
                }).catch(() => undefined);
            }
            await CreditBalance.updateOne(
                { organizationId },
                { $inc: { balanceMicro: chargeMicro } },
            ).catch((e) =>
                console.warn(
                    `[contact-reveal] balance compensation failed org=${organizationId}: ${e?.message || e}`,
                ),
            );
        }
        throw ledgerErr;
    }

    const fieldSet: Record<string, { revealedAt: Date; idempotencyKey: string }> = {};
    for (const field of fieldsNeedingLedger) {
        fieldSet[`revealedFields.${field}`] = {
            revealedAt: now,
            idempotencyKey: fieldIdempotencyKey(organizationId, candidateKey, field),
        };
    }

    const revealDoc = await HeadHunterContactReveal.findOneAndUpdate(
        { organizationId, candidateKey },
        {
            $set: fieldSet,
            $inc: { pieces: fieldsNeedingLedger.length, creditsCharged: fieldsNeedingLedger.length },
            $setOnInsert: {
                organizationId,
                candidateKey,
                revealedAt: now,
                revealedByClerkUserId: clerkUserId,
            },
        },
        { upsert: true, new: true, session },
    ).exec();

    if (!revealDoc) {
        return {
            ok: false,
            code: 'REVEAL_PERSIST_FAILED',
            message: 'Failed to persist contact reveal state',
        };
    }

    const auditOutboxId = await enqueueAuditOutbox(
        {
            organizationId,
            action: 'headhunter.contact_revealed',
            targetType: 'candidate',
            targetId: candidateKey,
            payload: {
                ...auditPayload,
                metadata: {
                    ...(auditPayload.metadata ?? {}),
                    fields: fieldsNeedingLedger,
                    creditsCharged: fieldsNeedingLedger.length,
                    candidateKey,
                },
            },
        },
        session,
    );

    return {
        ok: true,
        creditsCharged: fieldsNeedingLedger.length,
        newlyRevealedFields: fieldsNeedingLedger,
        revealedFields: listRevealedFieldsFromDoc(revealDoc, availableFields),
        balanceAfterMicro: updatedBalance.balanceMicro,
        auditOutboxId,
    };
}

async function readBalanceMicro(organizationId: string): Promise<number> {
    return (await CreditBalance.findOne({ organizationId }).exec())?.balanceMicro ?? 0;
}

function alreadyRevealedResult(
    candidateKey: string,
    doc: IHeadHunterContactReveal | null,
    availableFields: ContactRevealField[],
    balanceMicro: number,
): ContactRevealResult {
    return {
        ok: true,
        candidateKey,
        alreadyRevealed: true,
        creditsCharged: 0,
        newlyRevealedFields: [],
        revealedFields: doc ? listRevealedFieldsFromDoc(doc, availableFields) : availableFields,
        balanceAfterMicro: balanceMicro,
        creditsRemaining: microToWholeCredits(balanceMicro),
    };
}

export async function executeContactReveal(input: {
    organizationId: string;
    body: Record<string, unknown>;
    clerkUserId?: string;
    auditPayload: {
        actorClerkUserId?: string;
        actorEmail?: string;
        ip?: string;
        userAgent?: string;
    };
}): Promise<ContactRevealResult> {
    const { organizationId, body, clerkUserId, auditPayload } = input;

    const candidateKey = resolveCandidateKey(body);
    if (!candidateKey) {
        return { ok: false, code: 'CANDIDATE_ID_REQUIRED', message: 'candidate identity is required' };
    }

    const availableFields = parseAvailableContactFields(body);
    if (availableFields.length === 0) {
        return { ok: false, code: 'NO_CONTACT_PIECES', message: 'no_contact_pieces' };
    }

    const orgState = await OrgPlanState.findOne({ organizationId }).exec();
    if (!orgState) {
        return {
            ok: false,
            code: 'ORG_NOT_FOUND',
            message: 'Billing not configured for this organization',
        };
    }
    if (!isBillingActive(orgState.subscriptionStatus)) {
        return {
            ok: false,
            code: 'INACTIVE_SUBSCRIPTION',
            message: 'Subscription is not active',
        };
    }
    const feature = featureForUsageType('CONTACT_REVEAL');
    if (!planHasFeature(orgState.planId, feature)) {
        return {
            ok: false,
            code: 'FEATURE_DENIED',
            message: `Feature not included in plan: ${feature}`,
        };
    }

    const planSnapshot = buildPlanSnapshot(orgState);

    const preRead = await HeadHunterContactReveal.findOne({ organizationId, candidateKey }).exec();
    const fieldsToCharge = unrevealedFields(preRead, availableFields);

    if (fieldsToCharge.length === 0) {
        const balanceMicro = await readBalanceMicro(organizationId);
        return alreadyRevealedResult(candidateKey, preRead, availableFields, balanceMicro);
    }

    const run = async (session?: ClientSession): Promise<SettleResult> => {
        const fresh = await HeadHunterContactReveal.findOne({ organizationId, candidateKey })
            .session(session ?? null)
            .exec();
        const pending = unrevealedFields(fresh, availableFields);
        return settleContactReveal(
            {
                organizationId,
                candidateKey,
                fieldsToCharge: pending,
                availableFields,
                clerkUserId,
                auditPayload,
                planSnapshot,
            },
            session,
        );
    };

    let settled: SettleResult;
    const mongoSession = await mongoose.startSession();
    try {
        let captured: SettleResult | null = null;
        await mongoSession.withTransaction(async () => {
            captured = await run(mongoSession);
            if (!captured.ok) {
                throw Object.assign(new Error(captured.message), { revealCode: captured.code });
            }
        });
        settled = captured!;
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            const reread = await HeadHunterContactReveal.findOne({ organizationId, candidateKey }).exec();
            const balanceMicro = await readBalanceMicro(organizationId);
            return alreadyRevealedResult(candidateKey, reread, availableFields, balanceMicro);
        }
        if (isTransactionUnsupported(err)) {
            try {
                settled = await run(undefined);
            } catch (err2) {
                if (isDuplicateKeyError(err2)) {
                    const reread = await HeadHunterContactReveal.findOne({ organizationId, candidateKey }).exec();
                    const balanceMicro = await readBalanceMicro(organizationId);
                    return alreadyRevealedResult(candidateKey, reread, availableFields, balanceMicro);
                }
                throw err2;
            }
        } else {
            const revealCode =
                typeof err === 'object' && err !== null && 'revealCode' in err
                    ? String((err as { revealCode: string }).revealCode)
                    : null;
            if (revealCode) {
                return {
                    ok: false,
                    code: revealCode,
                    message: err instanceof Error ? err.message : revealCode,
                };
            }
            throw err;
        }
    } finally {
        await mongoSession.endSession();
    }

    if (!settled.ok) {
        return { ok: false, code: settled.code, message: settled.message };
    }

    if (settled.auditOutboxId) {
        dispatchAuditOutbox(settled.auditOutboxId);
    }

    return {
        ok: true,
        candidateKey,
        alreadyRevealed: settled.creditsCharged === 0,
        creditsCharged: settled.creditsCharged,
        newlyRevealedFields: settled.newlyRevealedFields,
        revealedFields: settled.revealedFields,
        balanceAfterMicro: settled.balanceAfterMicro,
        creditsRemaining: microToWholeCredits(settled.balanceAfterMicro),
        auditOutboxId: settled.auditOutboxId || undefined,
    };
}

export async function listRevealedContactStates(
    organizationId: string,
    keys: string[],
): Promise<
    Array<{
        candidateKey: string;
        revealedFields: ContactRevealField[];
        legacyFullReveal: boolean;
    }>
> {
    if (keys.length === 0) return [];
    const rows = await HeadHunterContactReveal.find({
        organizationId,
        candidateKey: { $in: keys },
    }).exec();

    return rows.map((row) => ({
        candidateKey: row.candidateKey,
        revealedFields: listRevealedFieldsFromDoc(row),
        legacyFullReveal: isLegacyFullReveal(row),
    }));
}
