/**
 * Full copy for Privacy, Terms, Data & Security, and About pages per locale.
 * Navigation/footer labels stay in translations.js via t(...) keys.
 */

import { privacyPolicyByLocale } from './privacyPolicy';
import { termsOfServiceByLocale } from './termsOfService';
import { dataSecurityByLocale } from './dataSecurity';
import { localizeLegalBrandDeep } from '../utils/localizeLegalBrandText.js';

const legalDocs = {
    en: {
        about: {
            introP1:
                'evaalo is an intelligent recruitment platform designed to transform how companies discover and evaluate talent.',
            introP2:
                'We combine artificial intelligence, automation, and modern workflows to simplify hiring processes and improve decision-making.',
            mission: {
                title: 'Our Mission',
                p1:
                    'Our mission is to make hiring smarter, faster, and more efficient by leveraging advanced technology.',
                p2:
                    'We aim to empower companies with better insights while providing candidates with a fair and seamless interview experience.',
            },
            whatWeDo: {
                title: 'What We Do',
                intro: 'At evaalo, we provide:',
                bullets: [
                    'AI-powered interview analysis',
                    'Automated recruitment workflows',
                    'Candidate evaluation tools',
                    'Seamless integrations with modern systems',
                ],
                foot:
                    'Our platform helps companies reduce manual effort and focus on what truly matters — finding the right talent.',
            },
            technology: {
                title: 'Our Technology',
                intro: 'We use a combination of:',
                bullets: [
                    'Artificial Intelligence for candidate analysis',
                    'Automation tools (such as n8n) for workflow management',
                    'Cloud infrastructure for scalability and reliability',
                ],
            },
            vision: {
                title: 'Our Vision',
                p:
                    'We envision a future where recruitment is driven by data, fairness, and intelligent systems — eliminating bias and improving outcomes for both companies and candidates.',
            },
            why: {
                title: 'Why evaalo?',
                bullets: [
                    'Faster hiring decisions',
                    'Better candidate insights',
                    'Scalable automation',
                    'Modern and flexible architecture',
                ],
            },
            contact: {
                title: 'Contact Us',
                intro:
                    'We’re always open to feedback, partnerships, and collaboration.',
            },
        },
    },
    ar: {
        about: {
            introP1:
                'إيفالو منصّة ذكية للتوظيف صُمّمت لتغيير طريقة اكتشاف الشركات للمواهب وتقييمها.',
            introP2:
                'نجمع بين الذكاء الاصطناعي والأتمتة وسير عمل حديث لنبسّط مسارات التوظيف ونحسّن جودة القرارات.',
            mission: {
                title: 'مهمتنا',
                p1:
                    'هدفنا جعل التوظيف أكثر ذكاءً وسرعة وكفاءة من خلال الاستفادة من التقنية المتقدمة.',
                p2:
                    'نسعى تمكين الشركات برؤى أوضح، مع تجربة مقابلات عادلة وسلسة للمرشحين.',
            },
            whatWeDo: {
                title: 'ما نقدمه',
                intro: 'في إيفالو نوفر:',
                bullets: [
                    'تحليل مقابلات مدعوم بالذكاء الاصطناعي',
                    'أتمتة مسارات التوظيف وإدارتها',
                    'أدوات لتقييم المرشحين',
                    'تكامل سلس مع الأنظمة الحديثة',
                ],
                foot:
                    'يساعد أسلوب عملنا الشركات على تقليل الجهد اليدوي والتركيز على ما يهم حقاً — اختيار المواهب المناسبة.',
            },
            technology: {
                title: 'تقنيتنا',
                intro: 'نستخدم:',
                bullets: [
                    'ذكاء اصطناعي لمساعدة تحليل أداء المرشحين',
                    'أدوات أتمتة (مثل n8n) لإدارة سير العمل',
                    'بنية أساسية سحابية للتوسع والموثوقية',
                ],
            },
            vision: {
                title: 'رؤيتنا',
                p:
                    'نتطلع لمستقبل يعتمد التوظيف على البيانات والعدالة والأنظمة الذكية — مع تقليل التحيز وتحسين النتائج للشركات والمرشحين على السواء.',
            },
            why: {
                title: 'لماذا إيفالو؟',
                bullets: [
                    'قرارات توظيف أسرع',
                    'رؤى أوضح حول المرشحين',
                    'أتمتة قابلة للتوسع',
                    'هندسة تقنية مرنة وحديثة',
                ],
            },
            contact: {
                title: 'تواصل معنا',
                intro:
                    'نرحّب بالملاحظات والشراكات والتعاون في أي وقت.',
            },
        },
    },
    ku: {
        about: {
            introP1:
                'evaalo پلاتفۆرمێکی زیرەکی دامەزراندنە کە یارمەتی کۆمپانیاکان دەدات بۆ دۆزینەوە و هەڵسەنگاندنی توانا بە شێوەیەکی نوێ.',
            introP2:
                'زیرەکی دەستکرد و خۆکارکردن و ڕێڕەوی نوێ تێکەڵ دەکەین بۆ ئاسانکردنی پرۆسەی دامەزراندن و باشترکردنی بڕیارەکان.',
            mission: {
                title: 'ئامانجەکانمان',
                p1:
                    'ئامانجمان بە زیرەکی و خێرا و کارامە کردنی دامەزراندنە لە ڕێگەی تەکنەلۆژیای پێشکەوتووەوە.',
                p2:
                    'دەتوانین کۆمپانیاکان بە بینینی باشتر دەستگەمۆ بکەین و لە هەمان کاتدا ئەزموونی چاوپێکەوتنی دادپەڕوان بۆ کاندید دابین بکەین.',
            },
            whatWeDo: {
                title: 'ئێمە چی دەکەین',
                intro: 'لە evaalo ئەمە دابین دەکەین:',
                bullets: [
                    'شیکردنەوەی چاوپێکەوتن بە یارمەتی زیرەکی دەستکرد',
                    'ڕێڕەوی خۆکارکراوی دامەزراندن',
                    'ئامێرەکانی هەڵسەنگاندنی کاندید',
                    'ئینتگرەیشنی باش لەگەڵ سیستەمەکانی نوێ',
                ],
                foot:
                    'پلاتفۆرمەکە یارمەتی کۆمپانیاکان دەدات کەمکردنەوە لە کارە دەستییەکان و زیاتر تەرکیز لەسەر دۆزینەوەی کەسەکانی گونجاو بکرێتەوە.',
            },
            technology: {
                title: 'تەکنەلۆژیای ئێمە',
                intro: 'تێکەڵەیەک بەکاردەهێنین لە:',
                bullets: [
                    'زیرەکی دەستکرد بۆ شیکردنەوەی کاندیدەکان',
                    'ئامێرەکانی خۆکارکردن (وەک n8n) بۆ بەڕێوەبردنی workflow',
                    'زەیرەسی هەوری بۆ گونجاندنێکی گەوربوون و متمانەی کار',
                ],
            },
            vision: {
                title: 'بینینی ئێمە',
                p:
                    'بینینمان بۆ داهاتوو دامەزراندن دەبێت بەسەر بنەمای داتا، دادپەرووانی و سیستەمە زیرەکییەکان بەرەو پێش بچێت — بۆ کەمکردنەوەی لایەنگری و باشترکردنی ئەنجام بۆ کۆمپانیا و کاندیدەکان.',
            },
            why: {
                title: 'بۆچی evaalo؟',
                bullets: [
                    'بڕیاری دامەزراندنی خێرا',
                    'تێڕوانین بە کاندید تەواوتر',
                    'خۆکارکردنی گونجاو',
                    'تێڕوانین تەکنیکی نوێ و نەرمین',
                ],
            },
            contact: {
                title: 'پەیوەندی',
                intro:
                    'هەمیشە ئامادەین بۆ فیدباک، هاوبەشی و هاوکاری.',
            },
        },
    },
};

export function getLegalDocs(lang) {
    const locale = lang === 'ar' || lang === 'ku' || lang === 'en' ? lang : 'en';
    const docs = legalDocs[locale];
    return localizeLegalBrandDeep(
        {
            ...docs,
            privacy: privacyPolicyByLocale[locale] ?? privacyPolicyByLocale.en,
            terms: termsOfServiceByLocale[locale] ?? termsOfServiceByLocale.en,
            security: dataSecurityByLocale[locale] ?? dataSecurityByLocale.en,
        },
        locale,
    );
}
