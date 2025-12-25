import mongoose, { Document, Schema } from 'mongoose';

export interface IRecruitmentCampaign extends Document {
    campaignId: string; // معرف فريد للحملة
    // معايير ديناميكية - يمكن إضافة أي معيار
    criteria: {
        [key: string]: any; // position, location, job, company, age, gender, educationLevel, etc.
    };
    interviewType?: string; // process, video, audio
    templateType?: string;
    templateName?: string;
    createdAt: Date;
    updatedAt: Date;
}

const RecruitmentCampaignSchema = new Schema<IRecruitmentCampaign>({
    campaignId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    // معايير ديناميكية - جميع المعايير المختارة من قبل الأدمن
    criteria: {
        type: Schema.Types.Mixed,
        required: true,
        default: {}
    },
    interviewType: {
        type: String,
        required: false
    },
    templateType: {
        type: String,
        required: false
    },
    templateName: {
        type: String,
        required: false
    }
}, {
    timestamps: true
});

export default mongoose.model<IRecruitmentCampaign>('RecruitmentCampaign', RecruitmentCampaignSchema);

