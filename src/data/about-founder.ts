import type { Language } from "@/lib/lms/types";

// About Swaraanjanam + Notes from the Founder, in English and Malayalam.
//
// Source: "Swaraanjanam Website Content About and Founder Notes (English +
// Malayalam).pdf", supplied by the academy. Text is reproduced exactly as
// supplied — do not reword or translate here; send changes back to the
// academy for approval instead.

export interface AboutFounderContent {
  about: {
    heading: string;
    /** Paragraphs. `founderName` inside the first paragraph is shown in bold. */
    paragraphs: string[];
    learnHeading: string;
    learnItems: string[];
    differentHeading: string;
    differentText: string;
    tagline: string;
  };
  founder: {
    heading: string;
    greeting: string;
    paragraphs: string[];
    signOff: string;
    name: string;
    title: string;
  };
  /** Name as it appears inside the About text, emphasised like the source. */
  founderName: string;
}

export const aboutFounderContent: Record<Language, AboutFounderContent> = {
  en: {
    founderName: "Dr. Anjana R. Menon",
    about: {
      heading: "About Swaraanjanam",
      paragraphs: [
        "Swaraanjanam is an online Carnatic music academy founded by Dr. Anjana R. Menon. Our vision is simple: to share the beauty and depth of Carnatic music with music lovers everywhere.",
        "At Swaraanjanam, we believe learning music is not about age, voice, or background. Every person has different strengths. When guided properly through the concepts, the musical journey becomes both entertaining and fulfilling. It does take dedication, perseverance, and commitment, but with the right guidance, you can sing, and you can enjoy it.",
      ],
      learnHeading: "What you will learn",
      learnItems: [
        "Carnatic music basics and foundational exercises",
        "Music theory",
        "Voice exercises",
        "Bhajans and sthuthis",
        "Devotional music",
      ],
      differentHeading: "What makes us different",
      differentText:
        "For many people, learning music has been a frustrating experience: left behind in large batches, or repeating the same lessons again and again without real progress. Here, we believe each person should be taught differently to reach the same destination. Different roads, same end sight. We walk with you patiently, step by step, until you reach that beautiful destination.",
      tagline: "Different roads. One beautiful destination.",
    },
    founder: {
      heading: "Notes from the Founder",
      greeting: "Namaskaram,",
      paragraphs: [
        "I'm Anjana, an engineer by training, with a PhD, and a musician and teacher by heart. Engineering taught me to break complex things into simple, logical steps. Music taught me patience, devotion, and joy. Swaraanjanam brings these together.",
        "To me, music is a divine language that connects all lives. But the ability to sing and the ability to enjoy music are different things. I have met many music lovers who struggle to sing, and many skilled people with no genuine interest in music. I would love to guide both. Those who are skilled can be trained to develop interest, and those who are interested can be trained to sing too.",
        "Building confidence and answering curious doubts gives me so much pleasure. I also love using modern tools to create engaging study materials and exercises that make learning fun. And I love teaching, especially children.",
        "If you are a music lover, or you feel skilled in music, and you have the patience to develop your skills, come join us on this joyful journey together.",
      ],
      signOff: "With love and swaras,",
      name: "Dr. Anjana R. Menon",
      title: "Founder, Swaraanjanam Online Music Academy",
    },
  },
  ml: {
    founderName: "ഡോ. അഞ്ജന ആർ. മേനോൻ",
    about: {
      heading: "സ്വരാഞ്ജനത്തെക്കുറിച്ച്",
      paragraphs: [
        "ഡോ. അഞ്ജന ആർ. മേനോൻ സ്ഥാപിച്ച ഒരു ഓൺലൈൻ കർണാടക സംഗീത അക്കാദമിയാണ് സ്വരാഞ്ജനം. കർണാടക സംഗീതത്തിന്റെ ഭംഗിയും ആഴവും എല്ലാ സംഗീതപ്രേമികളിലേക്കും എത്തിക്കുക എന്നതാണ് ഞങ്ങളുടെ ലക്ഷ്യം.",
        "സംഗീതം പഠിക്കുന്നത് പ്രായത്തെയോ ശബ്ദത്തെയോ പശ്ചാത്തലത്തെയോ ആശ്രയിച്ചല്ല എന്ന് ഞങ്ങൾ വിശ്വസിക്കുന്നു. ഓരോരുത്തർക്കും അവരവരുടേതായ കഴിവുകളുണ്ട്. ശരിയായ മാർഗനിർദേശത്തിലൂടെ ആശയങ്ങൾ മനസ്സിലാക്കി മുന്നേറിയാൽ സംഗീതയാത്ര ആസ്വാദ്യകരവും സംതൃപ്തി നൽകുന്നതുമാകും. അർപ്പണബോധവും സ്ഥിരോത്സാഹവും പ്രതിബദ്ധതയും വേണം; ഒപ്പം ശരിയായ മാർഗനിർദേശം ഉണ്ടെങ്കിൽ നിങ്ങൾക്കും പാടാം, ആസ്വദിക്കാം.",
      ],
      learnHeading: "നിങ്ങൾ എന്തെല്ലാം പഠിക്കും",
      learnItems: [
        "കർണാടക സംഗീതത്തിന്റെ അടിസ്ഥാനങ്ങളും അഭ്യാസങ്ങളും",
        "സംഗീത സിദ്ധാന്തം",
        "വോയ്സ് എക്സർസൈസുകൾ",
        "ഭജനകളും സ്തുതികളും",
        "ഭക്തിഗാനങ്ങൾ",
      ],
      differentHeading: "ഞങ്ങളെ വ്യത്യസ്തരാക്കുന്നത്",
      differentText:
        "പലർക്കും സംഗീതപഠനം ഒരു ദുരനുഭവമായിരുന്നു: വലിയ ബാച്ചുകളിൽ പിന്നിലായിപ്പോകുന്നു, അല്ലെങ്കിൽ പുരോഗതിയില്ലാതെ ഒരേ പാഠം വിരസമായി ആവർത്തിക്കുന്നു. എന്നാൽ ഒരേ ലക്ഷ്യത്തിലെത്താൻ ഓരോരുത്തരെയും വ്യത്യസ്തമായി നയിക്കണം എന്നാണ് ഞങ്ങളുടെ വിശ്വാസം. വഴികൾ പലത്, ലക്ഷ്യം ഒന്ന്. ആ മനോഹരമായ ലക്ഷ്യത്തിലേക്ക് ക്ഷമയോടെ, ഓരോ ചുവടും ഒപ്പം നിന്ന് ഞങ്ങൾ നിങ്ങളെ കൊണ്ടുപോകും.",
      tagline: "വഴികൾ പലത്. ലക്ഷ്യം മനോഹരമായ ഒന്ന്.",
    },
    founder: {
      heading: "സ്ഥാപകയുടെ കുറിപ്പ്",
      greeting: "നമസ്കാരം,",
      paragraphs: [
        "ഞാൻ അഞ്ജന. പഠനം കൊണ്ട് എൻജിനീയറും പിഎച്ച്ഡി ബിരുദധാരിയും, മനസ്സുകൊണ്ട് ഒരു സംഗീതജ്ഞയും അധ്യാപികയും. സങ്കീർണമായ കാര്യങ്ങളെ ലളിതമായ ഘട്ടങ്ങളായി തിരിക്കാൻ എൻജിനീയറിംഗ് എന്നെ പഠിപ്പിച്ചു. ക്ഷമയും ഭക്തിയും സന്തോഷവും സംഗീതം എന്നെ പഠിപ്പിച്ചു. ഇവ രണ്ടും ഒന്നിക്കുന്നതാണ് സ്വരാഞ്ജനം.",
        "സംഗീതം എല്ലാ ജീവനുകളെയും ബന്ധിപ്പിക്കുന്ന ദിവ്യഭാഷയാണെന്നാണ് എന്റെ വിശ്വാസം. പക്ഷേ പാടാനുള്ള കഴിവും സംഗീതം ആസ്വദിക്കാനുള്ള കഴിവും രണ്ടും വ്യത്യസ്തമാണ്. പാടാൻ ബുദ്ധിമുട്ടുന്ന ഒട്ടേറെ സംഗീതപ്രേമികളെയും, കഴിവുണ്ടായിട്ടും സംഗീതത്തിൽ യഥാർത്ഥ താൽപ്പര്യമില്ലാത്ത പലരെയും ഞാൻ കണ്ടിട്ടുണ്ട്. ഇരുകൂട്ടരെയും നയിക്കാൻ എനിക്ക് ഇഷ്ടമാണ്. കഴിവുള്ളവരിൽ താൽപ്പര്യം വളർത്തിയെടുക്കാം, താൽപ്പര്യമുള്ളവരെ പാടാനും പരിശീലിപ്പിക്കാം.",
        "ആത്മവിശ്വാസം വളർത്തുന്നതും, കൗതുകമുള്ള സംശയങ്ങൾക്ക് ഉത്തരം നൽകുന്നതും എനിക്ക് ഏറെ സന്തോഷം നൽകുന്നു. പഠനം രസകരമാക്കുന്ന ആകർഷകമായ പഠനസാമഗ്രികളും അഭ്യാസങ്ങളും ആധുനിക ഉപകരണങ്ങൾ ഉപയോഗിച്ച് ഒരുക്കുന്നതിലും എനിക്ക് വലിയ ഉത്സാഹമാണ്. അധ്യാപനം, പ്രത്യേകിച്ച് കുട്ടികളെ പഠിപ്പിക്കുന്നത്, എനിക്ക് ഏറെ ഇഷ്ടമാണ്.",
        "നിങ്ങൾ ഒരു സംഗീതപ്രേമിയാണെങ്കിലും, സംഗീതത്തിൽ കഴിവുണ്ടെന്ന് തോന്നുന്നവരാണെങ്കിലും, കഴിവുകൾ വളർത്താനുള്ള ക്ഷമ നിങ്ങൾക്കുണ്ടെങ്കിൽ, ഈ സന്തോഷകരമായ യാത്രയിൽ ഞങ്ങളോടൊപ്പം ചേരൂ.",
      ],
      signOff: "സ്നേഹത്തോടെ, സ്വരങ്ങളോടെ,",
      name: "ഡോ. അഞ്ജന ആർ. മേനോൻ",
      title: "സ്ഥാപക, സ്വരാഞ്ജനം ഓൺലൈൻ മ്യൂസിക് അക്കാദമി",
    },
  },
};
