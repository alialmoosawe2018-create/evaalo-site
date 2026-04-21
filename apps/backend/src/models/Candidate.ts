import mongoose, { Schema, Document } from 'mongoose';

// Interface للمرشح
export interface ICandidate extends Document {
    full_name: string;
    email: string;
    phone: string;
    location?: string;
    gender?: string;
    position_applied_for: string;
    company_applied_to?: string;
    years_of_experience: string;
    current_company?: string;
    highest_education_level?: string;
    linkedin?: string;
    skills: string[];
    languages: string[];
    certifications?: string;
    availability?: string;
    /** راتب متوقع واحد من الاستمارة (بدل نطاق min/max) */
    expectedSalary?: string;
    salaryMin?: string;
    salaryMax?: string;
    salaryCurrency?: string;
    coverLetter?: string;
    hearAboutUs?: string;
    agreeToTerms: boolean;
    status?: 'pending' | 'accepted' | 'rejected';
    interviewDate?: Date;
    aiEvaluation?: {
        score: number;
        communication: number;
        technical: number;
        problemSolving: number;
        confidence: number;
        feedback: string;
    };
    writtenInterviewEvaluation?: {
        overall_score: number; // 0-100
        fit_for_role: string;
        strengths: string[];
        weaknesses: string[];
        red_flags: string[];
        final_hr_evaluation?: string;
        recommendation: 'Hire' | 'Consider' | 'Reject';
        summary: string; // professional 3-5 sentence evaluation
    };
    voiceInterviewEvaluation?: {
        /** رقم 0–10 أو نص من n8n */
        communication?: number | string;
        language_fluency?: string;
        confidence?: string;
        problem_solving?: number | string;
        digital_skills?: string;
        overall_fit?: string;
        professional_attitude?: string;
        strengths?: string[];
        weaknesses?: string[];
        final_hr_evaluation?: string;
        overall_score: number;
        recommendation: 'Hire' | 'Consider' | 'Reject';
        summary?: string;
    };
    videoInterviewEvaluation?: {
        role_understanding?: number; // 0-10
        professional_depth?: number; // 0-10
        problem_handling?: number; // 0-10
        decision_making?: number; // 0-10
        prioritization?: number; // 0-10
        process_thinking?: number; // 0-10
        responsibility?: number; // 0-10
        learning_ability?: number; // 0-10
        job_readiness?: number; // 0-10
        final_role_fit?: number; // 0-10
        overall_score: number; // 0-100 percentage
        recommendation: 'Hire' | 'Consider' | 'Reject';
        summary?: string;
    };
    files?: Array<{
        kind?: 'cv' | 'photo';
        filename: string;
        originalName: string;
        path: string;
        mimeType: string;
        size: number;
        uploadedAt: Date;
    }>;
    notes?: string;
    /** نفس `campaignId` من RecruitmentCampaign — لربط المرشح بالحملة ومقارنة المرشحين ضمنها */
    campaignId?: string;
    createdAt: Date;
    updatedAt: Date;
}

// Schema للمرشح
const CandidateSchema = new Schema<ICandidate>({
    full_name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    location: {
        type: String,
        trim: true
    },
    gender: {
        type: String,
        trim: true,
        lowercase: true
    },
    position_applied_for: {
        type: String,
        required: true,
        trim: true
    },
    company_applied_to: {
        type: String,
        trim: true
    },
    years_of_experience: {
        type: String,
        required: true
    },
    current_company: {
        type: String,
        trim: true
    },
    highest_education_level: {
        type: String,
        trim: true
    },
    linkedin: {
        type: String,
        trim: true
    },
    skills: {
        type: [String],
        default: []
    },
    languages: {
        type: [String],
        default: []
    },
    certifications: {
        type: String,
        trim: true
    },
    availability: {
        type: String,
        trim: true
    },
    expectedSalary: {
        type: String,
        trim: true
    },
    salaryMin: {
        type: String,
        trim: true
    },
    salaryMax: {
        type: String,
        trim: true
    },
    salaryCurrency: {
        type: String,
        default: 'USD'
    },
    coverLetter: {
        type: String,
        trim: true
    },
    hearAboutUs: {
        type: String,
        trim: true
    },
    campaignId: {
        type: String,
        trim: true,
        index: true,
        default: undefined
    },
    agreeToTerms: {
        type: Boolean,
        required: true,
        default: false
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'pending'
    },
    interviewDate: {
        type: Date
    },
    aiEvaluation: {
        score: Number,
        communication: Number,
        technical: Number,
        problemSolving: Number,
        confidence: Number,
        feedback: String
    },
    writtenInterviewEvaluation: {
        overall_score: {
            type: Number,
            min: 0,
            max: 100
        },
        fit_for_role: String,
        strengths: [String],
        weaknesses: [String],
        red_flags: [String],
        final_hr_evaluation: String,
        recommendation: {
            type: String,
            enum: ['Hire', 'Consider', 'Reject']
        },
        summary: String
    },
    voiceInterviewEvaluation: {
        communication: Schema.Types.Mixed,
        language_fluency: String,
        confidence: String,
        problem_solving: Schema.Types.Mixed,
        digital_skills: String,
        overall_fit: String,
        professional_attitude: String,
        strengths: [String],
        weaknesses: [String],
        final_hr_evaluation: String,
        overall_score: {
            type: Number,
            min: 0,
            max: 100
        },
        recommendation: {
            type: String,
            enum: ['Hire', 'Consider', 'Reject']
        },
        summary: String
    },
    videoInterviewEvaluation: {
        role_understanding: {
            type: Number,
            min: 0,
            max: 10
        },
        professional_depth: {
            type: Number,
            min: 0,
            max: 10
        },
        problem_handling: {
            type: Number,
            min: 0,
            max: 10
        },
        decision_making: {
            type: Number,
            min: 0,
            max: 10
        },
        prioritization: {
            type: Number,
            min: 0,
            max: 10
        },
        process_thinking: {
            type: Number,
            min: 0,
            max: 10
        },
        responsibility: {
            type: Number,
            min: 0,
            max: 10
        },
        learning_ability: {
            type: Number,
            min: 0,
            max: 10
        },
        job_readiness: {
            type: Number,
            min: 0,
            max: 10
        },
        final_role_fit: {
            type: Number,
            min: 0,
            max: 10
        },
        overall_score: {
            type: Number,
            min: 0,
            max: 100
        },
        recommendation: {
            type: String,
            enum: ['Hire', 'Consider', 'Reject']
        },
        summary: String
    },
    files: [{
        kind: {
            type: String,
            enum: ['cv', 'photo']
        },
        filename: String,
        originalName: String,
        path: String,
        mimeType: String,
        size: Number,
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true // يضيف createdAt و updatedAt تلقائياً
});

// Export Model
export default mongoose.model<ICandidate>('Candidate', CandidateSchema, 'candidates');


















