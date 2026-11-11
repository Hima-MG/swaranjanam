// Frequently asked questions, from the academy's course details workbook
// ("FAQ" sheet). The fee answer, marked there as "please check", uses the
// fee details the academy has since confirmed (₹400 / ₹750 per session,
// billed at month end, no registration fee); the amounts are filled in from
// the billing rates in force, never typed here. The earlier 10% sibling
// discount is replaced by the approved Learn Together rates.
// Policies the workbook marks as suggestions are not included.

import { formatMoney } from "@/lib/format";
import type { PublicCourseFees } from "@/lib/catalog/public-pricing";
import { siteConfig } from "@/config/site";
import { SHARED_RATES } from "@/lib/lms/registration";

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqItems(fee: PublicCourseFees | null): FaqItem[] {
  const fees = fee
    ? `${[fee.batchMinor !== null ? `Batch classes are ${formatMoney(fee.batchMinor)} per class per student` : "", fee.individualMinor !== null ? `individual classes ${formatMoney(fee.individualMinor)} per session` : ""].filter(Boolean).join(" and ")}. You pay for your first class or session when you enrol; that payment is deducted on your first monthly invoice. After that you are invoiced on the last day of each calendar month for the classes held, and pay within 3 days. There is no registration fee.`
    : "Fees are charged per session. You pay for your first class or session when you enrol, and that payment is deducted on your first monthly invoice. After that you are invoiced on the last day of each calendar month for the classes held, and pay within 3 days. There is no registration fee.";
  return [
    {
      question: "What are the class days and timings?",
      answer:
        "Class schedules are confirmed after registration. The academy assigns students to suitable batches or confirms individual class timings based on teacher availability and student preferences. Students receive their confirmed schedule through their dashboard and email.",
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
      question: "Can two people learn together?",
      answer: `Yes – with Learn Together, two learners share one student login and dashboard: ${formatMoney(SHARED_RATES.batchMinor)} per person per batch session (${formatMoney(SHARED_RATES.batchMinor * 2)} for both), or ${formatMoney(SHARED_RATES.individualMinor)} per person per one-to-one session (${formatMoney(SHARED_RATES.individualMinor * 2)} for both).`,
    },
    {
      question: "What if I miss a class?",
      answer:
        "A class that was conducted is counted even if you missed it, because the recording is shared with you to learn from. So please try not to miss classes!",
    },
    {
      question: "What if I cancel a class?",
      answer: "A class you cancel is still included in your monthly invoice, and the academy provides you with the recording of that class.",
    },
    {
      question: "What if the academy cancels a class?",
      answer: "You are not charged for a class the academy cancels — it is left out of your monthly invoice.",
    },
    {
      question: "Are sessions recorded?",
      answer:
        "Yes! Every class is recorded and shared privately with you, along with notations, lyrics and interactive practice widgets on your personal student dashboard, so you can practise at your own pace.",
    },
    {
      question: "Can students from abroad join?",
      answer: "Absolutely! We already have students from abroad. Class timings are confirmed after registration, taking your time zone and preferences into account.",
    },
    {
      question: "What will be taught?",
      answer:
        "Carnatic music basics – sruti and talam, varisais, alankarams, bhajans, devotional songs, voice culture and singing tips, tailored to each student's age and level.",
    },
    {
      question: "Do I need any book or app?",
      answer:
        "Yes. Please get Sangeetha Sampoorna – Beginners Level by Dr. Anuradha Mahesh (order on WhatsApp 80757 56318), and download the Jalra app from the Google Play Store or App Store for sruti and tala during class.",
    },
    {
      question: "How long is the course?",
      answer: "There is no fixed duration. Every learner progresses at their own pace, based on their level and aim.",
    },
    {
      question: "How do I enroll?",
      answer: `Open a course under Courses & fees and select “Enrol Now”. Sign in or create a free account, choose batch or individual classes, add the learner's details and preferred days and times, and pay for the first class online. The academy then places you in a batch (or confirms your individual schedule), and your class appears on your student dashboard. You can also WhatsApp us at ${siteConfig.contact.whatsapp}.`,
    },
  ];
}
