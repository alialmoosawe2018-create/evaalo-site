/**
 * One-off: resend a voice interview transcript to n8n Stage 2.
 * Usage: node scripts/resend-voice-stage2-once.mjs
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { finalizeAndSendVoiceTranscriptToN8N } = await import('../src/services/n8nService.ts');

const sessionId = 'c47ef95e-207a-414d-930e-359517420809';
const candidateId = '6a45788c80bdb6358cf93cfb';
const campaignId = '6606bf9964a7b3d06430a4ba4ea75e1f';

const conversationHistory = [
  { role: 'assistant', content: 'أهلاً وسهلاً موها نجم، عندك مقابلة لوظيفة شريك أعمال الموارد البشرية. نتمنى لك التوفيق!' },
  { role: 'user', content: 'اهلا وسهلا بك. بحضرتك التوفيق للجميع يا رب.' },
  { role: 'assistant', content: 'طيب، ممكن تخبرني عن خلفيتك وتجربتك بشكل عام؟' },
  { role: 'user', content: 'اكيد اني مو عندي خبره عشر سنوات خريج من خريجي الاقتصاد ادارة اقتصاد واقتصاد. عندي خبره اكثر من 10 سنوات بالموارد البشرية واقدر اخدمكم. يعني في قسم الموارد البشرية من خلال هذه المهام.' },
  { role: 'assistant', content: 'ممتاز، خبرتك في الموارد البشرية مهمة جداً. شنو التحديات اللي واجهتها خلال السنوات الماضية وكيف تعاملت وياها؟' },
  { role: 'user', content: 'واجهت العديد من التحديات وقدرت تتخطاها من أتخطاها منها. عدد الموظفين العالي. ضغط العمل العالي صعوبة الموارد. صعوبة التعليم. صعوبة التلقي. تلقي الأوامر والمهام. ولكن كلها قد تتخطاها.' },
  { role: 'assistant', content: 'عاشت ايدك، شنو كان رد فعل الفريق أو الموظفين على هالتحديات، وكيف أثرت على أدائهم؟' },
  { role: 'user', content: 'خلينا نغير السؤال. لو سمحتي' },
  { role: 'assistant', content: 'تمام، شنو البرامج أو الأدوات اللي تعتمد عليها في شغلك اليومي؟' },
  { role: 'user', content: 'اكيد برامج مايكروسوفت المايكروسوفت مايكروسوفت اوفيس. برامج التواصل مثل الاوتلوك وغيره من البرامج برامج الديزاين نحتاجها احيانا.' },
  { role: 'assistant', content: 'تمام، شنو تقييمك لمستواك في برامج مايكروسوفت أوفيس، وليش تفضل برنامج معين منهم أكثر؟' },
  { role: 'user', content: 'افضل برنامج المايكروسوفت مايكروسوفت وورد لاني ساعدني بزنس بارنر او مساعد موارد بشرية يساعدني على تنظيم ملفات الموظفين' },
  { role: 'assistant', content: 'حلو، شنو الميزات اللي تحبها في برنامج مايكروسوفت وورد واللي تخليك تعتمد عليه في تنظيم ملفات الموظفين؟' },
  { role: 'user', content: 'دعنا نغير خلينا نغير السؤال' },
  { role: 'assistant', content: 'تمام، شلون توصل فكرة شغلك لشخص ما عنده خبرة تقنية؟' },
  { role: 'user', content: 'دعيني غير خليني غير السؤال أيضا.' },
  { role: 'assistant', content: 'تمام، شنو الطريقة اللي تتبعها عادةً لحل المشاكل؟ وكمان، ممكن تشرحلي شنو الخطوات اللي تسويها بهالمواقف؟' },
  { role: 'user', content: 'غير دعنا نغير السؤال' },
  { role: 'assistant', content: 'تمام، شلون تتعامل مع ضغط الشغل لما يبدأ يتراكم عليك؟' },
  { role: 'user', content: 'دعنا خلينا نغير السوال السؤال ايضا' },
  { role: 'assistant', content: 'تمام، شلون تستخدم مهارة "التواصل" في شغلك؟' },
  { role: 'user', content: 'ممكن بالانجليزي. نحكي بالانجليزي لو سمحتي.' },
  { role: 'assistant', content: 'بعد شوية راح نوصل لمرحلة اختبار الإنجليزية.خلينا نكمل. ممتاز، شنو تستخدم مهارة "التواصل" بشغلك؟' },
  { role: 'user', content: 'ممكن تعرفيني عن نفسج نفسي وحضرتك.' },
  { role: 'assistant', content: 'آني إيفالو، مساعد موارد بشرية افتراضي يعمل بالذكاء الاصطناعي. دوري هو إدارة المقابلة معك خطوة بخطوة، من خلال طرح أسئلة منظمة وتحليل إجاباتك بشكل دقيق، حتى تنطي صورة واضحة عن أدائك وفق معايير تقييم معتمدة. خلينا نكمل المقابلة. ممتاز، شنو تستخدم مهارة "التواصل" بشغلك؟' },
];

const ok = await finalizeAndSendVoiceTranscriptToN8N({
  sessionId,
  candidateId,
  campaignId,
  language: 'ar',
  conversationHistory,
});

console.log(ok ? '✅ Resent voice transcript to n8n' : '❌ Failed to resend');
