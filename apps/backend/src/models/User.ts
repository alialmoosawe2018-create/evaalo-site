// ============================================
// ملف: models/User.ts
// الوظيفة: نسخة مرآة من مستخدمي Clerk داخل MongoDB
// (Source of truth = Clerk؛ التحديث يتم عبر webhooks لا عبر JIT).
// ============================================

import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    /** Clerk user id (user_xxx) — المفتاح الحقيقي للسجل. */
    clerkUserId: string;
    /** primary email من Clerk (lowercase). */
    email: string;
    fullName?: string;
    companyName?: string;
    /** وصف الشركة — يُستخدم في توليد إعلان الوظيفة (About the company) وغيره. */
    companyDescription?: string;
    /** true when fullName, companyName, and email are all present (mirrors Clerk publicMetadata). */
    profileComplete?: boolean;
    imageUrl?: string;
    /** المؤسسة الأساسية الحالية للمستخدم (org_xxx). */
    primaryOrgId?: string;
    /** الدور المعكوس من publicMetadata في Clerk. */
    role?: string;
    /** صلاحيات effective — مزيج role bundle + overrides من Clerk. */
    permissions: string[];
    /** قائمة العضويات (organizations) الحالية. */
    memberships?: Array<{
        organizationId: string;
        role: string;
        permissions: string[];
        joinedAt: Date;
    }>;
    /** Soft delete — لو حُذف المستخدم في Clerk. */
    deletedAt?: Date;
    /** تفضيلات واجهة المستخدم — لا تُزامَن مع Clerk. */
    preferences?: {
        /** إخفاء المقابلات الأقدم من هذا التاريخ من لوحة التحكم (ليس حذف مرشحين). */
        dashboardRecentInterviewsClearedAt?: Date;
    };
    createdAt: Date;
    updatedAt: Date;
}

const MembershipSchema = new Schema(
    {
        organizationId: { type: String, required: true, index: true },
        role: { type: String, default: '' },
        permissions: { type: [String], default: [] },
        joinedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const UserSchema = new Schema<IUser>(
    {
        clerkUserId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            index: true,
            lowercase: true,
            trim: true,
        },
        fullName: {
            type: String,
            trim: true,
        },
        companyName: {
            type: String,
            trim: true,
        },
        companyDescription: {
            type: String,
            trim: true,
            maxlength: 2000,
        },
        profileComplete: {
            type: Boolean,
            default: false,
        },
        imageUrl: {
            type: String,
            trim: true,
        },
        primaryOrgId: {
            type: String,
            trim: true,
            index: true,
        },
        role: {
            type: String,
            trim: true,
        },
        permissions: {
            type: [String],
            default: [],
        },
        memberships: {
            type: [MembershipSchema],
            default: [],
        },
        deletedAt: {
            type: Date,
            default: undefined,
            index: true,
        },
        preferences: {
            dashboardRecentInterviewsClearedAt: {
                type: Date,
                default: undefined,
            },
        },
    },
    {
        timestamps: true,
        collection: 'users',
    }
);

UserSchema.index({ deletedAt: 1, primaryOrgId: 1 });

export default mongoose.model<IUser>('User', UserSchema);
