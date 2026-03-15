import { Router } from 'express';

const router = Router();

// ─── Valid Enums ──────────────────────────────────────────────────────────────

const VALID_EXAMS       = ['WBCS', 'SSC', 'Railway', 'Banking', 'Police'];
const VALID_SUBJECTS    = ['History', 'Geography', 'Polity', 'Reasoning', 'Math', 'Current Affairs'];
const VALID_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

// ─── Groq Helper ─────────────────────────────────────────────────────────────

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant',
];

async function callGroq(systemPrompt, userPrompt, maxTokens = 2000) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  for (const model of GROQ_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.7,
          max_tokens: maxTokens,
          top_p: 0.9,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt   },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) { console.warn(`[govt] model ${model} HTTP ${res.status}`); continue; }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) { console.warn(`[govt] model ${model} empty content`); continue; }
      console.log(`[govt] success with ${model}`);
      return content;
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[govt] model ${model} error:`, err.message);
    }
  }
  throw new Error('All Groq models failed');
}

function extractJSON(text) {
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const start = Math.min(
    stripped.indexOf('[') === -1 ? Infinity : stripped.indexOf('['),
    stripped.indexOf('{') === -1 ? Infinity : stripped.indexOf('{'),
  );
  if (start === Infinity) throw new Error('No JSON found in AI response');
  return JSON.parse(stripped.slice(start));
}

async function fetchJSONFromGroq(systemPrompt, userPrompt, maxTokens, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const raw = await callGroq(systemPrompt, userPrompt, maxTokens);
      return extractJSON(raw);
    } catch (err) {
      lastErr = err;
      console.warn(`[govt] attempt ${attempt}/${maxRetries} failed:`, err.message);
    }
  }
  throw lastErr;
}

// ─── Fallback Seed: Questions ─────────────────────────────────────────────────

const FALLBACK_QUESTIONS = [
  // ── WBCS · History ──
  {
    id: 1, exam: 'WBCS', subject: 'History', difficulty: 'Easy', year: 2023,
    question: 'Who was the first Governor-General of India?',
    options: ['Lord Mountbatten', 'Warren Hastings', 'Lord Cornwallis', 'Lord Dalhousie'],
    correctIndex: 1,
    explanation: 'Warren Hastings was the first Governor-General of Bengal (1772) and effectively the first Governor-General of British India.',
    explanationBn: 'ওয়ারেন হেস্টিংস ছিলেন বাংলার প্রথম গভর্নর-জেনারেল (১৭৭২)।'
  },
  {
    id: 2, exam: 'WBCS', subject: 'History', difficulty: 'Medium', year: 2022,
    question: 'The Partition of Bengal in 1905 was announced by which Viceroy?',
    options: ['Lord Curzon', 'Lord Minto', 'Lord Hardinge', 'Lord Ripon'],
    correctIndex: 0,
    explanation: 'Lord Curzon announced the Partition of Bengal in 1905 to weaken the growing nationalist movement.',
    explanationBn: 'লর্ড কার্জন ১৯০৫ সালে বঙ্গভঙ্গ ঘোষণা করেন।'
  },
  {
    id: 3, exam: 'WBCS', subject: 'History', difficulty: 'Hard', year: 2021,
    question: 'Which treaty ended the Third Anglo-Maratha War?',
    options: ['Treaty of Bassein', 'Treaty of Pune', 'Treaty of Mandsaur', 'Treaty of Salbai'],
    correctIndex: 2,
    explanation: 'The Treaty of Mandsaur (1818) ended the Third Anglo-Maratha War, effectively ending Maratha power.',
    explanationBn: 'মন্দসোরের সন্ধি (১৮১৮) তৃতীয় ইঙ্গ-মারাঠা যুদ্ধের সমাপ্তি ঘটায়।'
  },
  // ── WBCS · Geography ──
  {
    id: 4, exam: 'WBCS', subject: 'Geography', difficulty: 'Easy', year: 2023,
    question: 'Which river is known as the "Sorrow of Bengal"?',
    options: ['Hooghly', 'Damodar', 'Teesta', 'Kangsabati'],
    correctIndex: 1,
    explanation: 'The Damodar river was called the "Sorrow of Bengal" due to its frequent devastating floods.',
    explanationBn: 'দামোদর নদীকে বাংলার শোক বলা হত কারণ এটি প্রায়ই বিধ্বংসী বন্যা ঘটাত।'
  },
  {
    id: 5, exam: 'WBCS', subject: 'Geography', difficulty: 'Medium',
    question: 'The Sundarbans mangrove forest is shared between India and which other country?',
    options: ['Myanmar', 'Sri Lanka', 'Bangladesh', 'Nepal'],
    correctIndex: 2,
    explanation: 'The Sundarbans spans the delta of the Ganges, Brahmaputra and Meghna rivers across India and Bangladesh.',
    explanationBn: 'সুন্দরবন ভারত ও বাংলাদেশ জুড়ে বিস্তৃত।'
  },
  {
    id: 6, exam: 'WBCS', subject: 'Geography', difficulty: 'Hard',
    question: 'Which pass connects Sikkim with Tibet?',
    options: ['Nathu La', 'Bum La', 'Shipki La', 'Lipulekh'],
    correctIndex: 0,
    explanation: 'Nathu La pass at 4310 m connects Gangtok (Sikkim) with Yadong (Tibet).',
    explanationBn: 'নাথু লা গিরিপথ সিকিমকে তিব্বতের সাথে সংযুক্ত করে।'
  },
  // ── WBCS · Polity ──
  {
    id: 7, exam: 'WBCS', subject: 'Polity', difficulty: 'Easy', year: 2022,
    question: 'Which article of the Indian Constitution abolishes untouchability?',
    options: ['Article 14', 'Article 15', 'Article 17', 'Article 21'],
    correctIndex: 2,
    explanation: 'Article 17 abolishes untouchability and its practice in any form is a punishable offence.',
    explanationBn: 'সংবিধানের ১৭ নং অনুচ্ছেদ অস্পৃশ্যতা বিলুপ্ত করে।'
  },
  {
    id: 8, exam: 'WBCS', subject: 'Polity', difficulty: 'Medium', year: 2020,
    question: 'The concept of "Basic Structure" of the Constitution was established in which case?',
    options: ['Golaknath Case', 'Kesavananda Bharati Case', 'Minerva Mills Case', 'Maneka Gandhi Case'],
    correctIndex: 1,
    explanation: "The Kesavananda Bharati case (1973) established the Basic Structure doctrine limiting Parliament's power to amend the Constitution.",
    explanationBn: 'কেশবানন্দ ভারতী মামলায় (১৯৭৩) সংবিধানের মৌলিক কাঠামো মতবাদ প্রতিষ্ঠিত হয়।'
  },
  {
    id: 9, exam: 'WBCS', subject: 'Polity', difficulty: 'Hard',
    question: 'Which schedule of the Constitution deals with anti-defection law?',
    options: ['Eighth Schedule', 'Ninth Schedule', 'Tenth Schedule', 'Eleventh Schedule'],
    correctIndex: 2,
    explanation: 'The Tenth Schedule (added by 52nd Amendment, 1985) contains provisions about disqualification on grounds of defection.',
    explanationBn: 'দশম তফসিল (৫২তম সংশোধনী, ১৯৮৫) দলত্যাগ বিরোধী আইন সম্পর্কিত।'
  },
  // ── WBCS · Reasoning ──
  {
    id: 10, exam: 'WBCS', subject: 'Reasoning', difficulty: 'Easy',
    question: 'Find the odd one out: Cat, Dog, Cow, Sparrow',
    options: ['Cat', 'Dog', 'Cow', 'Sparrow'],
    correctIndex: 3,
    explanation: 'Sparrow is a bird; all others are mammals.',
    explanationBn: 'স্প্যারো একটি পাখি; বাকি সবগুলি স্তন্যপায়ী।'
  },
  {
    id: 11, exam: 'WBCS', subject: 'Reasoning', difficulty: 'Medium',
    question: 'If A=1, B=2, ..., Z=26, what is the value of WBCS?',
    options: ['47', '52', '56', '43'],
    correctIndex: 0,
    explanation: 'W=23, B=2, C=3, S=19. Sum = 23+2+3+19 = 47.',
    explanationBn: 'W=২৩, B=২, C=৩, S=১৯; মোট = ৪৭।'
  },
  {
    id: 12, exam: 'WBCS', subject: 'Reasoning', difficulty: 'Hard',
    question: 'In a certain code, PENCIL = RGPEMP. How is ERASER coded?',
    options: ['GTCUGT', 'GUCUCT', 'GTCUGV', 'GVCUGT'],
    correctIndex: 0,
    explanation: 'Each letter is shifted by +2: E→G, R→T, A→C, S→U, E→G, R→T → GTCUGT.',
    explanationBn: 'প্রতিটি অক্ষর +২ করে পরিবর্তিত হয়।'
  },
  // ── WBCS · Math ──
  {
    id: 13, exam: 'WBCS', subject: 'Math', difficulty: 'Easy',
    question: 'What is 15% of 200?',
    options: ['25', '30', '35', '40'],
    correctIndex: 1,
    explanation: '15/100 × 200 = 30.',
    explanationBn: '১৫/১০০ × ২০০ = ৩০।'
  },
  {
    id: 14, exam: 'WBCS', subject: 'Math', difficulty: 'Medium',
    question: 'A train 150 m long passes a pole in 15 seconds. What is its speed in km/h?',
    options: ['30', '36', '40', '45'],
    correctIndex: 1,
    explanation: 'Speed = 150/15 = 10 m/s = 10 × 18/5 = 36 km/h.',
    explanationBn: 'গতি = ১৫০/১৫ = ১০ মি/সে = ৩৬ কিমি/ঘ।'
  },
  {
    id: 15, exam: 'WBCS', subject: 'Math', difficulty: 'Hard', year: 2021,
    question: 'If the compound interest on a sum for 2 years at 10% per annum is ₹210, find the simple interest.',
    options: ['₹180', '₹190', '₹200', '₹210'],
    correctIndex: 2,
    explanation: 'CI = P×0.21 = 210 → P = 1000. SI = 1000×10×2/100 = ₹200.',
    explanationBn: 'মূলধন = ১০০০ টাকা, সাধারণ সুদ = ২০০ টাকা।'
  },
  // ── WBCS · Current Affairs ──
  {
    id: 16, exam: 'WBCS', subject: 'Current Affairs', difficulty: 'Easy', year: 2024,
    question: "West Bengal's Duare Sarkar scheme primarily aims to deliver which services?",
    options: ['Only healthcare', 'Government services at doorstep', 'Only pensions', 'Only education'],
    correctIndex: 1,
    explanation: 'Duare Sarkar ("Government at your doorstep") camps deliver various state government services to citizens.',
    explanationBn: 'দুয়ারে সরকার প্রকল্পে বিভিন্ন সরকারি পরিষেবা নাগরিকদের দোরগোড়ায় পৌঁছে দেওয়া হয়।'
  },
  {
    id: 17, exam: 'WBCS', subject: 'Current Affairs', difficulty: 'Medium', year: 2024,
    question: 'Which district was newly created in West Bengal in 2022?',
    options: ['Jhargram', 'Sundarban', 'Bishnupur', 'Ichamati'],
    correctIndex: 1,
    explanation: 'Sundarban district was carved out from South 24 Parganas in 2022.',
    explanationBn: '২০২২ সালে দক্ষিণ ২৪ পরগনা থেকে সুন্দরবন জেলা গঠিত হয়।'
  },
  {
    id: 18, exam: 'WBCS', subject: 'Current Affairs', difficulty: 'Hard', year: 2023,
    question: 'The Tajpur deep-sea port in West Bengal is planned on which coast?',
    options: ['Digha coast', 'Frazergunj coast', 'Bakkhali coast', 'Tajpur-Contai coast'],
    correctIndex: 3,
    explanation: 'Tajpur deep-sea port is located near Contai in Purba Medinipur district.',
    explanationBn: 'তাজপুর গভীর সমুদ্র বন্দর পূর্ব মেদিনীপুর জেলার কাঁথির কাছে অবস্থিত।'
  },
  // ── SSC · History ──
  {
    id: 19, exam: 'SSC', subject: 'History', difficulty: 'Easy', year: 2022,
    question: 'In which year did the Revolt of 1857 begin?',
    options: ['1855', '1856', '1857', '1858'],
    correctIndex: 2,
    explanation: "The Revolt of 1857, also called India's First War of Independence, began on May 10, 1857.",
    explanationBn: '১৮৫৭ সালের মহাবিদ্রোহ ১০ মে ১৮৫৭ সালে শুরু হয়।'
  },
  {
    id: 20, exam: 'SSC', subject: 'History', difficulty: 'Medium',
    question: 'Who founded the Indian National Congress in 1885?',
    options: ['Bal Gangadhar Tilak', 'A.O. Hume', 'Dadabhai Naoroji', 'Gopal Krishna Gokhale'],
    correctIndex: 1,
    explanation: 'Allan Octavian Hume, a retired British civil servant, founded the Indian National Congress in 1885.',
    explanationBn: 'অ্যালান অক্টাভিয়ান হিউম ১৮৮৫ সালে ভারতীয় জাতীয় কংগ্রেস প্রতিষ্ঠা করেন।'
  },
  {
    id: 21, exam: 'SSC', subject: 'History', difficulty: 'Hard', year: 2020,
    question: 'The Champaran Satyagraha of 1917 was related to which issue?',
    options: ['Salt tax', 'Land revenue', 'Indigo cultivation', 'Forced labour'],
    correctIndex: 2,
    explanation: "The Champaran Satyagraha (1917) was Gandhi's first civil disobedience movement against the exploitative indigo cultivation system.",
    explanationBn: 'চম্পারণ সত্যাগ্রহ (১৯১৭) নীল চাষের বিরুদ্ধে গান্ধীজির প্রথম সত্যাগ্রহ।'
  },
  // ── SSC · Geography ──
  {
    id: 22, exam: 'SSC', subject: 'Geography', difficulty: 'Easy', year: 2023,
    question: 'What is the longest river in India?',
    options: ['Yamuna', 'Godavari', 'Ganga', 'Indus'],
    correctIndex: 2,
    explanation: 'The Ganga is the longest river flowing entirely within India at approximately 2,525 km.',
    explanationBn: 'গঙ্গা ভারতের দীর্ঘতম নদী, প্রায় ২৫২৫ কিমি দীর্ঘ।'
  },
  {
    id: 23, exam: 'SSC', subject: 'Geography', difficulty: 'Medium',
    question: 'The Tropic of Cancer passes through how many Indian states?',
    options: ['6', '7', '8', '9'],
    correctIndex: 2,
    explanation: 'The Tropic of Cancer passes through 8 Indian states: Gujarat, Rajasthan, MP, Chhattisgarh, Jharkhand, WB, Tripura, Mizoram.',
    explanationBn: 'কর্কটক্রান্তি ভারতের ৮টি রাজ্যের মধ্য দিয়ে গেছে।'
  },
  {
    id: 24, exam: 'SSC', subject: 'Geography', difficulty: 'Hard', year: 2021,
    question: 'Which Indian state has the highest forest cover percentage?',
    options: ['Arunachal Pradesh', 'Mizoram', 'Meghalaya', 'Nagaland'],
    correctIndex: 1,
    explanation: 'Mizoram has the highest forest cover as a percentage of its geographical area (~85%).',
    explanationBn: 'মিজোরাম তার ভৌগোলিক এলাকার প্রায় ৮৫% বনাচ্ছাদিত।'
  },
  // ── SSC · Polity ──
  {
    id: 25, exam: 'SSC', subject: 'Polity', difficulty: 'Easy', year: 2022,
    question: 'How many items are in the Union List of the Indian Constitution?',
    options: ['97', '66', '47', '52'],
    correctIndex: 0,
    explanation: 'The Union List (Seventh Schedule) originally had 97 items on which only Parliament can legislate.',
    explanationBn: 'কেন্দ্রীয় তালিকায় মূলত ৯৭টি বিষয় ছিল।'
  },
  {
    id: 26, exam: 'SSC', subject: 'Polity', difficulty: 'Medium',
    question: 'The President of India is elected by which method?',
    options: ['Direct election', 'Single transferable vote', 'Cumulative voting', 'First past the post'],
    correctIndex: 1,
    explanation: 'The President is elected by an electoral college through proportional representation by means of single transferable vote.',
    explanationBn: 'রাষ্ট্রপতি একক হস্তান্তরযোগ্য ভোটের মাধ্যমে নির্বাচিত হন।'
  },
  {
    id: 27, exam: 'SSC', subject: 'Polity', difficulty: 'Hard', year: 2019,
    question: 'Under which article can the President proclaim a National Emergency?',
    options: ['Article 352', 'Article 356', 'Article 360', 'Article 365'],
    correctIndex: 0,
    explanation: 'Article 352 empowers the President to proclaim a National Emergency on grounds of war, external aggression or armed rebellion.',
    explanationBn: '৩৫২ নং অনুচ্ছেদ অনুযায়ী রাষ্ট্রপতি জাতীয় জরুরি অবস্থা জারি করতে পারেন।'
  },
  // ── SSC · Reasoning ──
  {
    id: 28, exam: 'SSC', subject: 'Reasoning', difficulty: 'Easy',
    question: 'Complete the series: 2, 4, 8, 16, ?',
    options: ['24', '30', '32', '36'],
    correctIndex: 2,
    explanation: 'Each term is double the previous: 16×2=32.',
    explanationBn: 'প্রতিটি পদ পূর্ববর্তী পদের দ্বিগুণ।'
  },
  {
    id: 29, exam: 'SSC', subject: 'Reasoning', difficulty: 'Medium',
    question: 'If 6×4=20 and 7×5=24, then 9×8=?',
    options: ['34', '40', '72', '42'],
    correctIndex: 0,
    explanation: 'Pattern: a+b+(a+b-2) = 2(a+b)-2. For 9,8: 2×17-2 = 32. Alternate: a+b+ab/6. Actually a×b-(a+b)/2: 6×4-5=19≠20. Try a+b+10=20 for (6,4)→20; (7,5)→24; (9,8)→25≠34. Pattern: (a-1)(b-1)+5: (5)(3)+5=20✓; (6)(4)+5=29≠24. Pattern a×b-ab/something. Sum pattern: 6+4=10+10=20; 7+5=12+12=24; 9+8=17+17=34.',
    explanationBn: 'ধারার নিয়ম: a+b এর দ্বিগুণ = ৩৪।'
  },
  {
    id: 30, exam: 'SSC', subject: 'Reasoning', difficulty: 'Hard',
    question: 'In a 5×5 matrix, how many squares of all sizes are possible?',
    options: ['50', '55', '60', '65'],
    correctIndex: 1,
    explanation: 'Total squares = 5²+4²+3²+2²+1² = 25+16+9+4+1 = 55.',
    explanationBn: '৫×৫ ম্যাট্রিক্সে মোট বর্গ = ৫৫।'
  },
  // ── SSC · Math ──
  {
    id: 31, exam: 'SSC', subject: 'Math', difficulty: 'Easy', year: 2022,
    question: 'What is the LCM of 12 and 18?',
    options: ['24', '36', '48', '72'],
    correctIndex: 1,
    explanation: 'LCM(12,18) = 36.',
    explanationBn: 'LCM(১২,১৮) = ৩৬।'
  },
  {
    id: 32, exam: 'SSC', subject: 'Math', difficulty: 'Medium',
    question: 'A shopkeeper sells an item at 20% profit. If the cost price is ₹500, find the selling price.',
    options: ['₹550', '₹580', '₹600', '₹620'],
    correctIndex: 2,
    explanation: 'SP = 500 × 1.20 = ₹600.',
    explanationBn: 'বিক্রয়মূল্য = ৫০০ × ১.২০ = ৬০০ টাকা।'
  },
  // ── SSC · Current Affairs ──
  {
    id: 33, exam: 'SSC', subject: 'Current Affairs', difficulty: 'Easy', year: 2024,
    question: "Which Indian city hosted the G20 Summit in 2023?",
    options: ['Mumbai', 'Chennai', 'New Delhi', 'Bengaluru'],
    correctIndex: 2,
    explanation: 'India hosted the G20 Summit on September 9–10, 2023 in New Delhi.',
    explanationBn: '২০২৩ সালের জি২০ সম্মেলন নয়াদিল্লিতে অনুষ্ঠিত হয়।'
  },
  {
    id: 34, exam: 'SSC', subject: 'Current Affairs', difficulty: 'Medium', year: 2023,
    question: "India's first indigenous aircraft carrier is named?",
    options: ['INS Vikrant', 'INS Viraat', 'INS Vikramaditya', 'INS Arihant'],
    correctIndex: 0,
    explanation: "INS Vikrant, India's first domestically built aircraft carrier, was commissioned in September 2022.",
    explanationBn: 'আইএনএস বিক্রান্ত হল ভারতের প্রথম স্বদেশ নির্মিত বিমানবাহী রণতরী।'
  },
  // ── Railway · History ──
  {
    id: 35, exam: 'Railway', subject: 'History', difficulty: 'Easy', year: 2023,
    question: 'When was the first railway line in India inaugurated?',
    options: ['1848', '1853', '1857', '1862'],
    correctIndex: 1,
    explanation: "India's first passenger railway line ran from Bombay (Bori Bunder) to Thane on April 16, 1853.",
    explanationBn: 'ভারতের প্রথম যাত্রীবাহী রেল ১৮৫৩ সালের ১৬ এপ্রিল বোম্বে থেকে থানে চালু হয়।'
  },
  {
    id: 36, exam: 'Railway', subject: 'History', difficulty: 'Medium',
    question: 'The Battle of Plassey (1757) was fought between British forces and which ruler?',
    options: ['Mir Qasim', 'Siraj ud-Daulah', 'Mir Jafar', 'Shuja ud-Daulah'],
    correctIndex: 1,
    explanation: 'The Battle of Plassey (June 23, 1757) saw Robert Clive defeat Siraj ud-Daulah, the Nawab of Bengal.',
    explanationBn: 'পলাশীর যুদ্ধে (১৭৫৭) সিরাজউদ্দৌলার বিরুদ্ধে ব্রিটিশরা জয়লাভ করে।'
  },
  // ── Railway · Geography ──
  {
    id: 37, exam: 'Railway', subject: 'Geography', difficulty: 'Easy',
    question: 'Which is the highest peak in India?',
    options: ['Mount Everest', 'Nanda Devi', 'Kangchenjunga', 'K2'],
    correctIndex: 2,
    explanation: 'Kangchenjunga (8,586 m) in Sikkim is the highest peak entirely within India.',
    explanationBn: 'কাঞ্চনজঙ্ঘা (৮৫৮৬ মি) ভারতের সর্বোচ্চ পর্বতশৃঙ্গ।'
  },
  {
    id: 38, exam: 'Railway', subject: 'Geography', difficulty: 'Medium', year: 2022,
    question: 'The Konkan Railway connects Mumbai to which city?',
    options: ['Goa', 'Mangaluru', 'Thiruvananthapuram', 'Kochi'],
    correctIndex: 1,
    explanation: 'Konkan Railway runs along the western coast from Roha (near Mumbai) to Thokur (near Mangaluru).',
    explanationBn: 'কোঙ্কণ রেলওয়ে মুম্বইয়ের কাছ থেকে মঙ্গালুরু পর্যন্ত চলে।'
  },
  // ── Railway · Polity ──
  {
    id: 39, exam: 'Railway', subject: 'Polity', difficulty: 'Easy',
    question: 'How many seats are there in the Rajya Sabha?',
    options: ['245', '250', '270', '280'],
    correctIndex: 0,
    explanation: 'The Rajya Sabha has a maximum strength of 250 members; currently 245 operational seats.',
    explanationBn: 'রাজ্যসভায় সর্বোচ্চ ২৫০টি আসন রয়েছে।'
  },
  {
    id: 40, exam: 'Railway', subject: 'Polity', difficulty: 'Medium', year: 2021,
    question: 'Which body recommends the allocation of funds between Centre and States?',
    options: ['Planning Commission', 'NITI Aayog', 'Finance Commission', 'Election Commission'],
    correctIndex: 2,
    explanation: 'The Finance Commission (Article 280) recommends the distribution of net proceeds of taxes between Centre and States.',
    explanationBn: 'অর্থ কমিশন (অনুচ্ছেদ ২৮০) কেন্দ্র ও রাজ্যের মধ্যে কর বণ্টনের সুপারিশ করে।'
  },
  // ── Railway · Reasoning ──
  {
    id: 41, exam: 'Railway', subject: 'Reasoning', difficulty: 'Easy',
    question: 'If DOG is coded as EPH, how is CAT coded?',
    options: ['DBU', 'DCD', 'DBT', 'EBU'],
    correctIndex: 0,
    explanation: 'Each letter is incremented by 1: C→D, A→B, T→U → DBU.',
    explanationBn: 'প্রতিটি অক্ষর ১ বাড়ানো হয়।'
  },
  // ── Railway · Math ──
  {
    id: 42, exam: 'Railway', subject: 'Math', difficulty: 'Easy', year: 2023,
    question: 'Find the average of 10, 20, 30, 40, 50.',
    options: ['25', '28', '30', '35'],
    correctIndex: 2,
    explanation: 'Average = (10+20+30+40+50)/5 = 30.',
    explanationBn: 'গড় = ৩০।'
  },
  {
    id: 43, exam: 'Railway', subject: 'Math', difficulty: 'Medium',
    question: 'Two numbers are in ratio 3:5. Their LCM is 75. Find the larger number.',
    options: ['15', '20', '25', '30'],
    correctIndex: 2,
    explanation: 'Let numbers = 3k and 5k. LCM = 15k = 75 → k=5. Larger = 25.',
    explanationBn: 'বড় সংখ্যা = ২৫।'
  },
  // ── Railway · Current Affairs ──
  {
    id: 44, exam: 'Railway', subject: 'Current Affairs', difficulty: 'Easy', year: 2024,
    question: 'India\'s Vande Bharat Express is a type of what?',
    options: ['Semi-high speed train', 'Maglev train', 'Monorail', 'Hyperloop'],
    correctIndex: 0,
    explanation: 'Vande Bharat Express is a semi-high speed train manufactured in India under the Make in India initiative.',
    explanationBn: 'বন্দে ভারত এক্সপ্রেস একটি আধা-উচ্চগতির ট্রেন।'
  },
  // ── Banking · History ──
  {
    id: 45, exam: 'Banking', subject: 'History', difficulty: 'Easy',
    question: 'When was the Reserve Bank of India established?',
    options: ['1930', '1935', '1947', '1950'],
    correctIndex: 1,
    explanation: 'The Reserve Bank of India was established on April 1, 1935 under the RBI Act, 1934.',
    explanationBn: 'ভারতীয় রিজার্ভ ব্যাঙ্ক ১৯৩৫ সালের ১ এপ্রিল প্রতিষ্ঠিত হয়।'
  },
  {
    id: 46, exam: 'Banking', subject: 'History', difficulty: 'Medium', year: 2022,
    question: "The Swadeshi Movement (1905) began as a protest against which British action?",
    options: ['Salt Law', 'Partition of Bengal', 'Rowlatt Act', 'Jallianwala Bagh massacre'],
    correctIndex: 1,
    explanation: "The Swadeshi Movement started as a reaction to Lord Curzon's partition of Bengal in 1905.",
    explanationBn: 'স্বদেশী আন্দোলন ১৯০৫ সালে বঙ্গভঙ্গের প্রতিক্রিয়ায় শুরু হয়।'
  },
  // ── Banking · Geography ──
  {
    id: 47, exam: 'Banking', subject: 'Geography', difficulty: 'Easy',
    question: 'Which is the largest state of India by area?',
    options: ['Maharashtra', 'Madhya Pradesh', 'Rajasthan', 'Uttar Pradesh'],
    correctIndex: 2,
    explanation: 'Rajasthan is the largest state in India by area at 342,239 km².',
    explanationBn: 'রাজস্থান আয়তনের দিক থেকে ভারতের বৃহত্তম রাজ্য।'
  },
  // ── Banking · Polity ──
  {
    id: 48, exam: 'Banking', subject: 'Polity', difficulty: 'Medium', year: 2023,
    question: 'Which Constitutional Amendment lowered the voting age from 21 to 18?',
    options: ['42nd', '52nd', '61st', '74th'],
    correctIndex: 2,
    explanation: 'The 61st Constitutional Amendment (1988) lowered the voting age from 21 to 18 years.',
    explanationBn: '৬১তম সাংবিধানিক সংশোধনী (১৯৮৮) ভোটদানের বয়স ২১ থেকে ১৮ বছর করে।'
  },
  // ── Banking · Reasoning ──
  {
    id: 49, exam: 'Banking', subject: 'Reasoning', difficulty: 'Medium',
    question: 'If all roses are flowers and some flowers fade quickly, which conclusion is valid?',
    options: [
      'All roses fade quickly',
      'Some roses may fade quickly',
      'No roses fade quickly',
      'All flowers are roses'
    ],
    correctIndex: 1,
    explanation: 'Since some flowers fade quickly and all roses are flowers, some roses may fade quickly.',
    explanationBn: 'যেহেতু সব গোলাপ ফুল এবং কিছু ফুল দ্রুত ঝরে, তাই কিছু গোলাপও দ্রুত ঝরতে পারে।'
  },
  // ── Banking · Math ──
  {
    id: 50, exam: 'Banking', subject: 'Math', difficulty: 'Hard', year: 2022,
    question: 'A sum of ₹8000 is invested at 5% per annum CI. What is the amount after 3 years?',
    options: ['₹9000', '₹9261', '₹9300', '₹9500'],
    correctIndex: 1,
    explanation: 'Amount = 8000 × (1.05)³ = ₹9261.',
    explanationBn: 'পরিমাণ = ৮০০০ × (১.০৫)³ = ৯২৬১ টাকা।'
  },
  // ── Banking · Current Affairs ──
  {
    id: 51, exam: 'Banking', subject: 'Current Affairs', difficulty: 'Easy', year: 2024,
    question: 'UPI (Unified Payments Interface) is regulated by which body?',
    options: ['SEBI', 'NPCI', 'RBI', 'IRDAI'],
    correctIndex: 1,
    explanation: 'UPI is a product developed and managed by the National Payments Corporation of India (NPCI).',
    explanationBn: 'UPI জাতীয় পেমেন্ট কর্পোরেশন অফ ইন্ডিয়া (NPCI) দ্বারা পরিচালিত।'
  },
  // ── Police · History ──
  {
    id: 52, exam: 'Police', subject: 'History', difficulty: 'Easy', year: 2023,
    question: 'Who wrote the book "Discovery of India"?',
    options: ['M.K. Gandhi', 'B.R. Ambedkar', 'Jawaharlal Nehru', 'Subhas Chandra Bose'],
    correctIndex: 2,
    explanation: '"Discovery of India" was written by Jawaharlal Nehru in 1946 while imprisoned at Ahmednagar Fort.',
    explanationBn: '"ডিসকভারি অফ ইন্ডিয়া" জওহরলাল নেহরু ১৯৪৬ সালে লেখেন।'
  },
  {
    id: 53, exam: 'Police', subject: 'History', difficulty: 'Medium',
    question: 'Netaji Subhas Chandra Bose founded the Indian National Army (INA) with support from which country?',
    options: ['Germany', 'Italy', 'Japan', 'Soviet Union'],
    correctIndex: 2,
    explanation: 'Subhas Chandra Bose reorganized the INA in Singapore with Japanese support in 1943.',
    explanationBn: 'নেতাজি সুভাষচন্দ্র বসু ১৯৪৩ সালে জাপানের সহায়তায় সিঙ্গাপুরে INA পুনর্গঠন করেন।'
  },
  // ── Police · Geography ──
  {
    id: 54, exam: 'Police', subject: 'Geography', difficulty: 'Easy',
    question: 'Which river flows through Kolkata?',
    options: ['Ganga', 'Hooghly', 'Bhagirathi', 'Damodar'],
    correctIndex: 1,
    explanation: 'The Hooghly (distributary of the Ganga) flows through Kolkata.',
    explanationBn: 'হুগলি নদী (গঙ্গার শাখানদী) কলকাতার মধ্য দিয়ে প্রবাহিত।'
  },
  {
    id: 55, exam: 'Police', subject: 'Geography', difficulty: 'Medium', year: 2021,
    question: 'The Buxa Tiger Reserve is located in which state?',
    options: ['Assam', 'West Bengal', 'Odisha', 'Jharkhand'],
    correctIndex: 1,
    explanation: 'Buxa Tiger Reserve is situated in the Alipurduar district of West Bengal.',
    explanationBn: 'বক্সা টাইগার রিজার্ভ পশ্চিমবঙ্গের আলিপুরদুয়ার জেলায় অবস্থিত।'
  },
  // ── Police · Polity ──
  {
    id: 56, exam: 'Police', subject: 'Polity', difficulty: 'Easy', year: 2022,
    question: 'The State Police is listed under which schedule of the Constitution?',
    options: ['Sixth Schedule', 'Seventh Schedule – Union List', 'Seventh Schedule – State List', 'Eighth Schedule'],
    correctIndex: 2,
    explanation: '"Police" is Entry 2 of the State List (Seventh Schedule), making it a state subject.',
    explanationBn: '"পুলিশ" রাজ্য তালিকার (সপ্তম তফসিল) ২ নং বিষয়।'
  },
  {
    id: 57, exam: 'Police', subject: 'Polity', difficulty: 'Hard', year: 2020,
    question: 'The National Commission for SC and ST was bifurcated by which Constitutional Amendment?',
    options: ['65th', '89th', '93rd', '100th'],
    correctIndex: 1,
    explanation: 'The 89th Constitutional Amendment (2003) bifurcated the combined Commission into separate commissions for SCs and STs.',
    explanationBn: '৮৯তম সাংবিধানিক সংশোধনী (২০০৩) SC ও ST-এর জন্য আলাদা কমিশন গঠন করে।'
  },
  // ── Police · Reasoning ──
  {
    id: 58, exam: 'Police', subject: 'Reasoning', difficulty: 'Easy',
    question: 'Which number comes next in the series: 1, 1, 2, 3, 5, 8, ?',
    options: ['11', '12', '13', '14'],
    correctIndex: 2,
    explanation: 'Fibonacci series: 5+8 = 13.',
    explanationBn: 'ফিবোনাচি ধারা: ৫+৮ = ১৩।'
  },
  // ── Police · Math ──
  {
    id: 59, exam: 'Police', subject: 'Math', difficulty: 'Medium',
    question: 'The perimeter of a rectangle is 60 cm and its length is 20 cm. Find its area.',
    options: ['200 cm²', '220 cm²', '240 cm²', '260 cm²'],
    correctIndex: 0,
    explanation: 'Width = (60/2) - 20 = 10 cm. Area = 20 × 10 = 200 cm².',
    explanationBn: 'প্রস্থ = ১০ সেমি। ক্ষেত্রফল = ২০০ বর্গসেমি।'
  },
  // ── Police · Current Affairs ──
  {
    id: 60, exam: 'Police', subject: 'Current Affairs', difficulty: 'Easy', year: 2024,
    question: 'What is the full form of SMART Policing initiative?',
    options: [
      'Strict Mobile Alert Response Team',
      'Strict and Sensitive, Modern and Mobile, Alert and Accountable, Reliable and Responsive, Techno-savvy and Trained',
      'Special Mobile Armed Response Team',
      'Systematic Management and Resource Tracking'
    ],
    correctIndex: 1,
    explanation: 'SMART Policing stands for Strict and Sensitive, Modern and Mobile, Alert and Accountable, Reliable and Responsive, Techno-savvy and Trained.',
    explanationBn: 'SMART পুলিশিং মানে কঠোর ও সংবেদনশীল, আধুনিক ও গতিশীল, সতর্ক ও দায়বদ্ধ, নির্ভরযোগ্য ও প্রতিক্রিয়াশীল, প্রযুক্তি-প্রেমী ও প্রশিক্ষিত।'
  },
];

// ─── Seed: Current Affairs ────────────────────────────────────────────────────

const FALLBACK_CURRENT_AFFAIRS = {
  news: [
    {
      id: 1,
      title: "West Bengal Launches \"Kanyashree Prakalpa\" Expansion",
      summary: 'The state government expands its flagship girl-child scholarship scheme to cover more rural beneficiaries in 2025.',
      category: 'Government Scheme',
      date: '2025-03-01',
      source: 'West Bengal Government',
      tags: ['WB', 'Education', 'Women Empowerment']
    },
    {
      id: 2,
      title: 'India Achieves 500 GW Renewable Energy Milestone',
      summary: 'India crosses the 500 gigawatt milestone in installed renewable energy capacity, ahead of the 2030 target.',
      category: 'Energy',
      date: '2025-02-20',
      source: 'Ministry of New and Renewable Energy',
      tags: ['Energy', 'Environment', 'Economy']
    },
    {
      id: 3,
      title: 'New Metro Rail Corridor Inaugurated in Kolkata',
      summary: 'Kolkata Metro extends the East-West corridor to Sector V, connecting IT hub to city centre.',
      category: 'Infrastructure',
      date: '2025-02-15',
      source: 'Kolkata Metro Rail Corporation',
      tags: ['Kolkata', 'Transport', 'Infrastructure']
    },
    {
      id: 4,
      title: 'WBPSC Announces 2025 Exam Calendar',
      summary: 'West Bengal Public Service Commission releases the schedule for WBCS and other state service examinations for 2025.',
      category: 'Exam',
      date: '2025-01-30',
      source: 'WBPSC',
      tags: ['WBCS', 'Exam', 'Government Jobs']
    },
    {
      id: 5,
      title: 'SSC CGL 2025 Notification Released',
      summary: 'Staff Selection Commission releases Combined Graduate Level 2025 notification with 17,000+ vacancies.',
      category: 'Exam',
      date: '2025-02-10',
      source: 'SSC',
      tags: ['SSC', 'Exam', 'Government Jobs']
    },
    {
      id: 6,
      title: 'Indian Railways Launches 100 New Vande Bharat Trains',
      summary: 'Railway Ministry announces Phase 2 of Vande Bharat Express, adding 100 new trains covering Northeast India.',
      category: 'Transport',
      date: '2025-01-25',
      source: 'Ministry of Railways',
      tags: ['Railway', 'Transport', 'Infrastructure']
    },
    {
      id: 7,
      title: 'RBI Cuts Repo Rate by 25 Basis Points',
      summary: 'The Reserve Bank of India reduces the benchmark repo rate to 6.25%, signaling support for economic growth.',
      category: 'Economy',
      date: '2025-02-07',
      source: 'RBI',
      tags: ['Banking', 'Economy', 'Finance']
    }
  ],
  weeklyQuiz: [
    { id: 1, topic: 'Current Affairs – February 2025',           questionCount: 10, duration: '10 min', difficulty: 'Medium' },
    { id: 2, topic: 'West Bengal Special Focus – Districts & History', questionCount: 10, duration: '10 min', difficulty: 'Easy' },
    { id: 3, topic: 'Indian Polity & Constitution',               questionCount: 15, duration: '15 min', difficulty: 'Hard'  }
  ],
  monthlyTopics: [
    {
      id: 1,
      topic: 'Union Budget 2025-26 Analysis',
      subtopics: ['Key Highlights', 'Revenue & Expenditure', 'Sectoral Allocation', 'Impact on Bengal'],
      targetExams: ['WBCS', 'Banking', 'SSC']
    },
    {
      id: 2,
      topic: 'India-Southeast Asia Relations',
      subtopics: ['ASEAN Summit', 'Trade Relations', 'Act East Policy', 'Security Cooperation'],
      targetExams: ['WBCS', 'SSC', 'Banking']
    },
    {
      id: 3,
      topic: 'Indian Geography – Rivers & Dams',
      subtopics: ['Major River Systems', 'Dam Projects 2025', 'Water Disputes', 'West Bengal Hydrology'],
      targetExams: ['WBCS', 'Railway', 'Police', 'SSC']
    }
  ]
};

// ─── Seed: Leaderboard ────────────────────────────────────────────────────────

const FALLBACK_LEADERBOARD = [
  { rank: 0, name: 'Arjun Mukherjee',  district: 'Kolkata',           weeklyScore: 980, monthlyScore: 3850, avatar: 'AM' },
  { rank: 0, name: 'Priya Banerjee',   district: 'Howrah',            weeklyScore: 965, monthlyScore: 3820, avatar: 'PB' },
  { rank: 0, name: 'Suvam Chatterjee', district: 'Bardhaman',         weeklyScore: 950, monthlyScore: 3790, avatar: 'SC' },
  { rank: 0, name: 'Debjani Roy',      district: 'Nadia',             weeklyScore: 935, monthlyScore: 3760, avatar: 'DR' },
  { rank: 0, name: 'Rahul Das',        district: 'Murshidabad',       weeklyScore: 920, monthlyScore: 3740, avatar: 'RD' },
  { rank: 0, name: 'Ananya Ghosh',     district: 'North 24 Parganas', weeklyScore: 905, monthlyScore: 3710, avatar: 'AG' },
  { rank: 0, name: 'Sourav Mondal',    district: 'Hooghly',           weeklyScore: 890, monthlyScore: 3685, avatar: 'SM' },
  { rank: 0, name: 'Tanushree Pal',    district: 'Purba Medinipur',   weeklyScore: 875, monthlyScore: 3650, avatar: 'TP' },
  { rank: 0, name: 'Bikash Sen',       district: 'Malda',             weeklyScore: 860, monthlyScore: 3620, avatar: 'BS' },
  { rank: 0, name: 'Nilanjana Dutta',  district: 'Jalpaiguri',        weeklyScore: 845, monthlyScore: 3590, avatar: 'ND' },
  { rank: 0, name: 'Pratik Sarkar',    district: 'Cooch Behar',       weeklyScore: 830, monthlyScore: 3550, avatar: 'PS' },
  { rank: 0, name: 'Moumita Bera',     district: 'South 24 Parganas', weeklyScore: 815, monthlyScore: 3520, avatar: 'MB' },
];

// ─── Seed: Dashboard ─────────────────────────────────────────────────────────

const FALLBACK_DASHBOARD = {
  stats: {
    totalQuestions: QUESTIONS.length,
    totalExams: 5,
    totalSubjects: 6,
    questionsWithPrevYear: FALLBACK_QUESTIONS.filter(q => q.year !== undefined).length,
    registeredUsers: 28750,
    totalAttempts: 142300,
  },
  upcomingExams: [
    { exam: 'WBCS Prelims 2025',   date: '2025-07-13', daysLeft: 127, registrationOpen: true  },
    { exam: 'SSC CGL Tier-I 2025', date: '2025-06-09', daysLeft: 93,  registrationOpen: true  },
    { exam: 'RRB NTPC 2025',       date: '2025-08-25', daysLeft: 170, registrationOpen: false },
    { exam: 'WB Police SI 2025',   date: '2025-09-14', daysLeft: 190, registrationOpen: false },
    { exam: 'SBI PO 2025',         date: '2025-05-18', daysLeft: 71,  registrationOpen: true  },
  ],
  topSubjects: [
    { subject: 'History',         attemptCount: 31200, avgScore: 68 },
    { subject: 'Polity',          attemptCount: 28500, avgScore: 62 },
    { subject: 'Geography',       attemptCount: 25800, avgScore: 71 },
    { subject: 'Current Affairs', attemptCount: 24100, avgScore: 59 },
    { subject: 'Reasoning',       attemptCount: 22600, avgScore: 74 },
    { subject: 'Math',            attemptCount: 20100, avgScore: 55 },
  ],
  recentActivity: [
    { type: 'quiz_completed', user: 'Arjun M.',  score: 9,  total: 10, subject: 'History',   timeAgo: '5 min ago'  },
    { type: 'quiz_completed', user: 'Priya B.',  score: 8,  total: 10, subject: 'Geography', timeAgo: '12 min ago' },
    { type: 'quiz_completed', user: 'Suvam C.',  score: 7,  total: 10, subject: 'Polity',    timeAgo: '20 min ago' },
    { type: 'quiz_completed', user: 'Debjani R.',score: 10, total: 10, subject: 'Reasoning', timeAgo: '35 min ago' },
    { type: 'quiz_completed', user: 'Rahul D.',  score: 6,  total: 10, subject: 'Math',      timeAgo: '47 min ago' },
  ],
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function assignRanks(arr, scoreKey) {
  return [...arr]
    .sort((a, b) => b[scoreKey] - a[scoreKey])
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

// ─── Endpoint 1: GET /questions ───────────────────────────────────────────────

router.get('/questions', async (req, res) => {
  const { exam, subject, difficulty, count } = req.query;

  if (!VALID_EXAMS.includes(exam))
    return res.status(400).json({ error: 'Invalid exam/subject/difficulty value' });
  if (!VALID_SUBJECTS.includes(subject))
    return res.status(400).json({ error: 'Invalid exam/subject/difficulty value' });
  if (!VALID_DIFFICULTIES.includes(difficulty))
    return res.status(400).json({ error: 'Invalid exam/subject/difficulty value' });

  const n = Math.min(100, Math.max(10, parseInt(count ?? '10', 10) || 10));

  const system = `You are an expert question-setter for Indian government competitive exams.
Always respond with ONLY a valid JSON array, no markdown, no explanation.`;

  const user = `Generate exactly ${n} multiple-choice questions for:
- Exam: ${exam}
- Subject: ${subject}
- Difficulty: ${difficulty}

Each question must follow this exact JSON shape:
{
  "id": <number>,
  "exam": "${exam}",
  "subject": "${subject}",
  "difficulty": "${difficulty}",
  "question": "<question text>",
  "options": ["<A>","<B>","<C>","<D>"],
  "correctIndex": <0|1|2|3>,
  "explanation": "<English explanation>",
  "explanationBn": "<Bengali explanation>"
}

Return a JSON array of exactly ${n} such objects. No markdown fences.`;

  try {
    const questions = await fetchJSONFromGroq(system, user, Math.min(4000, n * 350));
    if (!Array.isArray(questions) || questions.length === 0) throw new Error('AI returned empty array');
    return res.json(shuffle(questions).slice(0, n));
  } catch (err) {
    console.error('[govt /questions] AI failed after retries, using fallback:', err.message);
    let pool = FALLBACK_QUESTIONS.filter(q => q.exam === exam && q.subject === subject && q.difficulty === difficulty);
    if (pool.length < n) pool = FALLBACK_QUESTIONS.filter(q => q.exam === exam && q.subject === subject);
    if (pool.length < n) pool = FALLBACK_QUESTIONS.filter(q => q.exam === exam);
    return res.json(shuffle(pool).slice(0, n));
  }
});

// ─── Endpoint 2: GET /prev-year-questions ─────────────────────────────────────

router.get('/prev-year-questions', async (req, res) => {
  const { exam, year, subject } = req.query;

  if (exam    && !VALID_EXAMS.includes(exam))    return res.status(400).json({ error: 'Invalid exam value' });
  if (subject && !VALID_SUBJECTS.includes(subject)) return res.status(400).json({ error: 'Invalid subject value' });

  const examLabel    = exam    ? `Exam: ${exam}`       : 'any govt exam (WBCS/SSC/Railway/Banking/Police)';
  const yearLabel    = year    ? `Year: ${year}`        : 'various recent years (2018–2024)';
  const subjectLabel = subject ? `Subject: ${subject}` : 'mixed subjects';

  const system = `You are an expert on previous-year Indian government competitive exam questions.
Always respond with ONLY a valid JSON array, no markdown, no explanation.`;

  const user = `Generate 15 previous-year multiple-choice questions for:
- ${examLabel}
- ${yearLabel}
- ${subjectLabel}

Each question MUST have a "year" field and follow this JSON shape:
{
  "id": <number>,
  "exam": "<ExamName>",
  "subject": "<SubjectName>",
  "difficulty": "<Easy|Medium|Hard>",
  "year": <YYYY>,
  "question": "<question text>",
  "options": ["<A>","<B>","<C>","<D>"],
  "correctIndex": <0|1|2|3>,
  "explanation": "<English explanation>",
  "explanationBn": "<Bengali explanation>"
}

Return a JSON array. No markdown fences.`;

  try {
    const questions = await fetchJSONFromGroq(system, user, 5000);
    if (!Array.isArray(questions) || questions.length === 0) throw new Error('AI returned empty array');
    let result = questions.filter(q => q.year !== undefined);
    if (exam)    result = result.filter(q => q.exam === exam);
    if (year)    result = result.filter(q => String(q.year) === String(year));
    if (subject) result = result.filter(q => q.subject === subject);
    return res.json(result);
  } catch (err) {
    console.error('[govt /prev-year-questions] AI failed, using fallback:', err.message);
    let pool = FALLBACK_QUESTIONS.filter(q => q.year !== undefined);
    if (exam)    pool = pool.filter(q => q.exam === exam);
    if (year)    pool = pool.filter(q => String(q.year) === String(year));
    if (subject) pool = pool.filter(q => q.subject === subject);
    return res.json(pool);
  }
});

// ─── Endpoint 3: GET /current-affairs ────────────────────────────────────────

router.get('/current-affairs', async (_req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const system = `You are an expert on Indian current affairs, especially West Bengal.
Always respond with ONLY a valid JSON object, no markdown, no explanation.`;

  const user = `Generate current affairs data as of ${today} in this exact JSON shape:
{
  "news": [
    { "id": <n>, "title": "<headline>", "summary": "<2-3 sentence summary>", "category": "<category>", "date": "<YYYY-MM-DD>", "source": "<source>", "tags": ["<tag1>","<tag2>"] }
  ],
  "weeklyQuiz": [
    { "id": <n>, "topic": "<topic>", "questionCount": <10|15>, "duration": "<N min>", "difficulty": "<Easy|Medium|Hard>" }
  ],
  "monthlyTopics": [
    { "id": <n>, "topic": "<topic>", "subtopics": ["<sub1>","<sub2>","<sub3>"], "targetExams": ["<exam1>","<exam2>"] }
  ]
}

Requirements:
- Exactly 7 news items with real, relevant 2025 events for WBCS/SSC/Railway/Banking/Police aspirants
- Exactly 3 weeklyQuiz items
- Exactly 3 monthlyTopics
No markdown fences.`;

  try {
    const data = await fetchJSONFromGroq(system, user, 3000);
    if (!data.news || !Array.isArray(data.news)) throw new Error('Invalid structure');
    return res.json(data);
  } catch (err) {
    console.error('[govt /current-affairs] AI failed, using fallback:', err.message);
    return res.json(FALLBACK_CURRENT_AFFAIRS);
  }
});

// ─── Endpoint 4: GET /leaderboard ────────────────────────────────────────────

router.get('/leaderboard', async (req, res) => {
  const filter = req.query.filter ?? 'weekly';
  if (filter !== 'weekly' && filter !== 'monthly')
    return res.status(400).json({ error: "filter must be 'weekly' or 'monthly'" });

  const system = `You are generating a mock leaderboard for a West Bengal government exam prep platform.
Always respond with ONLY a valid JSON array, no markdown, no explanation.`;

  const user = `Generate 12 unique leaderboard entries. Each entry:
{
  "name": "<Bengali full name>",
  "district": "<West Bengal district>",
  "weeklyScore": <500-1000>,
  "monthlyScore": <2000-4000>,
  "avatar": "<2 capital initials>"
}

Use real WB districts (Kolkata, Howrah, Bardhaman, Nadia, Murshidabad, Hooghly, North 24 Parganas, South 24 Parganas, Purba Medinipur, Malda, Jalpaiguri, Cooch Behar).
Return a JSON array of exactly 12 entries. No markdown fences.`;

  try {
    const entries = await fetchJSONFromGroq(system, user, 1500);
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('AI returned empty array');
    const scoreKey = filter === 'weekly' ? 'weeklyScore' : 'monthlyScore';
    return res.json(assignRanks(entries, scoreKey));
  } catch (err) {
    console.error('[govt /leaderboard] AI failed, using fallback:', err.message);
    const scoreKey = filter === 'weekly' ? 'weeklyScore' : 'monthlyScore';
    return res.json(assignRanks(FALLBACK_LEADERBOARD, scoreKey));
  }
});

// ─── Endpoint 5: GET /dashboard ──────────────────────────────────────────────

router.get('/dashboard', async (_req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const system = `You are generating a dashboard summary for a West Bengal government exam prep platform.
Always respond with ONLY a valid JSON object, no markdown, no explanation.`;

  const user = `Generate a dashboard JSON object as of ${today}:
{
  "stats": { "totalQuestions": <n>, "totalExams": 5, "totalSubjects": 6, "questionsWithPrevYear": <n>, "registeredUsers": <n>, "totalAttempts": <n> },
  "upcomingExams": [ { "exam": "<name>", "date": "<YYYY-MM-DD>", "daysLeft": <n>, "registrationOpen": <true|false> } ],
  "topSubjects": [ { "subject": "<History|Geography|Polity|Reasoning|Math|Current Affairs>", "attemptCount": <n>, "avgScore": <40-90> } ],
  "recentActivity": [ { "type": "quiz_completed", "user": "<name>", "score": <1-10>, "total": 10, "subject": "<subject>", "timeAgo": "<N min ago>" } ]
}

Requirements: 5 upcoming WB/central govt exams with realistic 2025-2026 dates, all 6 subjects in topSubjects, 5 recentActivity entries. No markdown fences.`;

  try {
    const data = await fetchJSONFromGroq(system, user, 2000);
    if (!data.stats || !data.upcomingExams) throw new Error('Invalid structure');
    return res.json(data);
  } catch (err) {
    console.error('[govt /dashboard] AI failed, using fallback:', err.message);
    return res.json(FALLBACK_DASHBOARD);
  }
});

export default router;
