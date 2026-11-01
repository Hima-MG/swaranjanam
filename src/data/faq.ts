// Frequently asked questions, from the academy's course details workbook
// ("FAQ" sheet). The fee answer, marked there as "please check", uses the
// fee details the academy has since confirmed (₹400 / ₹750 per session,
// 10% off for siblings, billed at month end, no registration fee); the
// amounts are filled in from the billing rates in force, never typed here.
// Policies the workbook marks as suggestions are not included.

import { formatMoney } from "@/lib/format";
import type { PublicCourseFees } from "@/lib/catalog/public-pricing";
import { siteConfig } from "@/config/site";

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqItems(fee: PublicCourseFees | null): FaqItem[] {
  const fees = fee
    ? `Batch classes are ${formatMoney(fee.batchMinor)} per session per student, and individual classes are ${formatMoney(fee.individualMinor)} per session. Fees are paid at the end of each month for the classes conducted that month. There is no registration fee.`
    : "Fees are charged per session and paid at the end of each month for the classes conducted that month. There is no registration fee.";
  return [
    {
      question: "What are the class days and timings?",
      answer:
        "Classes are held on any day except Sunday. Timings are fixed for each batch, based on the schedules of all enrolled students in India and abroad, to find the best common slot. Current batch: Saturdays, 7–8 PM IST.",
    },
    {
      question: "Who can join?",
      answer:
        "Anyone who loves music but hasn't yet learned the basics – kids, adults, students, working professionals and homemakers. Complete beginners are welcome!",
    },
    {
      question: "How are classes conducted?",
      answer: "Classes are 100% online via Google Meet. Each session is 1 hour long, once a week, in small batches of up to 5 students.",
    },
    { question: "What are the fees?", answer: fees },
    {
      question: "Is there a discount for siblings?",
      answer: fee
        ? `Yes – siblings, or two learners joining from one device, get ${fee.siblingDiscountPercent}% off: ${formatMoney(fee.siblingBatchMinor)} per learner per batch session.`
        : "Yes – siblings, or two learners joining from one device, get 10% off.",
    },
    {
      question: "What if I miss a class?",
      answer:
        "A class that was conducted is counted even if you missed it, because the recording is shared with you to learn from. So please try not to miss classes!",
    },
    {
      question: "Are sessions recorded?",
      answer:
        "Yes! Every class is recorded and shared privately with you, along with notations, lyrics and interactive practice widgets on your personal student dashboard, so you can practise at your own pace.",
    },
    {
      question: "Can students from abroad join?",
      answer: "Absolutely! We already have students from abroad, and batch timings are fixed to suit both India and abroad.",
    },
    {
      question: "What will be taught?",
      answer:
        "Carnatic music basics – sruti and talam, varisais, alankarams, bhajans, devotional songs, voice culture and singing tips, tailored to each student's age and level.",
    },
    {
      question: "Do I need any book or app?",
      answer:
        "Yes. Please get Sangeetha Sampoorna – Beginners Level by Dr. Anuradha Mahesh (₹500 in India, $50 abroad; order on WhatsApp 80757 56318), and download the Jalra app from the Google Play Store or App Store for sruti and tala during class.",
    },
    {
      question: "How long is the course?",
      answer: "There is no fixed duration. Every learner progresses at their own pace, based on their level and aim.",
    },
    {
      question: "How do I enroll?",
      answer: `Simply WhatsApp us at ${siteConfig.contact.whatsapp} and we'll take it from there! You'll be added to a batch and get access to your student dashboard the same day.`,
    },
  ];
}
