/**
 * One-off: resend a video interview transcript to n8n Stage 3.
 * Usage: node scripts/resend-video-stage3-once.mjs
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { sendVideoTranscriptToN8N } = await import('../src/services/n8nService.ts');

const sessionId = 'video-interview-6a45788c80bdb6358cf93cfb-1783011250015';
const candidateId = '6a45788c80bdb6358cf93cfb';
const campaignId = '6606bf9964a7b3d06430a4ba4ea75e1f';

const conversationHistory = [
  { role: 'user', content: 'أهلا وسهلا ومرحبا شلونچ.' },
  { role: 'assistant', content: 'كلش زين، شنو الأساليب اللي تستخدمينها للتواصل مع قادة الأقسام لحل مشاكل الأداء؟' },
  { role: 'user', content: 'ممكن توضحي لي أكثر.' },
  { role: 'assistant', content: 'أفهم، خلينا ننتقل لموضوع ثاني.  شلون تتعاملين مع موظف صعب في الفريق؟' },
  { role: 'user', content: 'عن. مثلا. يعني شنو؟ تصرفاته؟' },
  { role: 'assistant', content: 'شنو كانت تصرفاته بالضبط؟' },
  { role: 'user', content: 'بَلكَت توضحي رسالة أكثر.' },
  { role: 'assistant', content: 'أريد أعرف شلون تتعاملين مع تصرفات الموظف الصعب، شنو الخطوات اللي تتخذينها؟' },
  { role: 'user', content: 'على حسب نوع. يعني تصرفات الموظف. شنو تقصدين بالموظف الصعب.' },
  { role: 'assistant', content: 'الموظف الصعب يعني اللي يسبب تحديات في العمل، مثل عدم التعاون أو السلوك السلبي.  شنو الخطوات اللي تتخذينها للتعامل مع هالموقف؟' },
  { role: 'user', content: 'شنو؟ السؤال.' },
  { role: 'assistant', content: 'أريد أعرف شنو كانت تجربتك مع موظف صعب، شنو كانت النتائج اللي حصلتي عليها بعد التعامل معاه؟' },
  { role: 'user', content: 'نغير. اذا ممكن سؤال اخر.' },
  { role: 'assistant', content: 'حسناً، خلينا نتحدث عن كيفية استخدامك للبيانات في HR لدعم القرارات المتعلقة بالقوى العاملة.  شلون تستخدمين البيانات في هذا السياق؟' },
  { role: 'user', content: 'خلينا نغير السؤال أيضا.' },
  { role: 'assistant', content: 'أفهم، خلينا نتحدث عن مبادرة تغيير كبيرة كان لـ HR دور رئيسي فيها.  شنو كانت تجربتك في هالمجال؟' },
];

const ok = await sendVideoTranscriptToN8N({
  sessionId,
  candidateId,
  campaignId,
  language: 'auto',
  conversationHistory,
});

console.log(ok ? '✅ Resent video transcript to n8n' : '❌ Failed to resend');
