import mongoose, { Schema, Document } from 'mongoose';

// Interface للمرشح
export interface ICandidate extends Document {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    location?: string;
    positionAppliedFor: string;
    yearsOfExperience: string;
    currentCompany?: string;
    highestEducationLevel?: string;
    linkedin?: string;
    skills: string[];
    languages: string[];
    certifications?: string;
    availability?: string;
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
        recommendation: 'Hire' | 'Consider' | 'Reject';
        summary: string; // professional 3-5 sentence evaluation
    };
    files?: Array<{
        filename: string;
        originalName: string;
        path: string;
        mimeType: string;
        size: number;
        uploadedAt: Date;
    }>;
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
}

// Schema للمرشح
const CandidateSchema = new Schema<ICandidate>({
    firstName: {
        type: String,
        required: true,
        trim: true
    },
    lastName: {
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
    positionAppliedFor: {
        type: String,
        required: true,
        trim: true
    },
    yearsOfExperience: {
        type: String,
        required: true
    },
    currentCompany: {
        type: String,
        trim: true
    },
    highestEducationLevel: {
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
        recommendation: {
            type: String,
            enum: ['Hire', 'Consider', 'Reject']
        },
        summary: String
    },
    files: [{
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


















