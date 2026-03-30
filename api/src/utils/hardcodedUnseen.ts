export interface HardcodedUnseenOption {
  text: string;
  isCorrect: boolean;
}

export interface HardcodedUnseenQuestion {
  prompt: string;
  explanation?: string;
  options: HardcodedUnseenOption[];
}

export interface HardcodedUnseenPassage {
  title: string;
  content: string;
  theme: string;
  difficultyKey: string;
  timeLimitSec: number;
  questions: HardcodedUnseenQuestion[];
}

export const HARD_CODED_UNSEEN_PASSAGES: HardcodedUnseenPassage[] = [
  {
    title: "The Bicycle Lanes That Changed a City",
    theme: "Urban Design",
    difficultyKey: "medium",
    timeLimitSec: 180,
    content:
      "Ten years ago, Rivergate was known for traffic jams, horn noise, and daily frustration. Most streets were designed for cars, and very few people felt safe riding bicycles. The city council decided to test a new idea: protected bicycle lanes on three major roads. At first, many shop owners worried that removing parking spaces would reduce customers. Drivers complained that roads would become slower. During the first month, usage was low, and critics said the project had failed. However, by the third month, the number of daily riders had tripled. Parents began cycling with children to school, and office workers used bicycles for short commutes. The city then connected the first three lanes to parks, bus stops, and train stations, creating a continuous network instead of isolated paths. Within two years, local studies showed fewer minor collisions, improved air quality, and faster travel times during peak hours for trips under five kilometers. Surprisingly, small businesses near the lanes reported higher foot traffic because riders stopped more often than passing drivers. Rivergate learned that infrastructure changes need patience. People rarely change habits overnight, but when safer options exist, behavior gradually follows. The lanes did not eliminate cars, yet they gave residents a practical alternative and made streets calmer for everyone.",
    questions: [
      {
        prompt: "What was the city council's first major action?",
        explanation: "The passage states that Rivergate first tested protected lanes on three major roads.",
        options: [
          { text: "Banned private cars downtown", isCorrect: false },
          { text: "Tested protected bicycle lanes on three major roads", isCorrect: true },
          { text: "Built a new subway system", isCorrect: false },
          { text: "Reduced the price of train tickets", isCorrect: false }
        ]
      },
      {
        prompt: "Why did some shop owners oppose the project initially?",
        options: [
          { text: "They expected fewer customers due to lost parking", isCorrect: true },
          { text: "They disliked bicycles as a concept", isCorrect: false },
          { text: "They wanted wider sidewalks instead", isCorrect: false },
          { text: "They were asked to fund the lanes directly", isCorrect: false }
        ]
      },
      {
        prompt: "What happened by the third month of the pilot?",
        options: [
          { text: "The city canceled the experiment", isCorrect: false },
          { text: "Daily ridership increased significantly", isCorrect: true },
          { text: "Only tourists used the lanes", isCorrect: false },
          { text: "Car speeds doubled across the city", isCorrect: false }
        ]
      },
      {
        prompt: "What was the effect of connecting lanes to transit and parks?",
        options: [
          { text: "The network became more useful than isolated paths", isCorrect: true },
          { text: "Cycling became limited to weekends", isCorrect: false },
          { text: "Bus services were removed", isCorrect: false },
          { text: "Road maintenance costs disappeared", isCorrect: false }
        ]
      },
      {
        prompt: "What central lesson did Rivergate learn?",
        options: [
          { text: "Cities should replace all cars immediately", isCorrect: false },
          { text: "Infrastructure needs time before behavior changes", isCorrect: true },
          { text: "Only business districts need bike lanes", isCorrect: false },
          { text: "Traffic problems are impossible to improve", isCorrect: false }
        ]
      }
    ]
  },
  {
    title: "Why Music and Mathematics Often Meet",
    theme: "Education",
    difficultyKey: "medium",
    timeLimitSec: 210,
    content:
      "Many students treat music and mathematics as unrelated subjects: one is emotional, the other logical. Yet historians note that ancient scholars often studied both together. Rhythm depends on fractions because beats are divided into equal parts. A measure in common time can be split into halves, quarters, or eighths, just like numerical values. Melody also has mathematical structure. Notes in a scale follow frequency ratios, and harmonious intervals are built on predictable relationships between sound waves. Modern music technology extends this connection. Digital audio software represents sound as sampled data points, which are stored and processed through algorithms. Producers use mathematical tools to remove noise, adjust pitch, and compress dynamic range. In classrooms, teachers who combine music and math activities report better engagement from students who struggle with abstract formulas. For example, clapping polyrhythms can help learners understand ratios and pattern recognition. That does not mean every musician enjoys equations or every mathematician plays an instrument. Instead, it suggests that different forms of thinking can reinforce each other. Creativity benefits from structure, and structure becomes more intuitive when experienced through sound. By exploring both subjects together, students often gain confidence and discover that problem solving can be both precise and expressive.",
    questions: [
      {
        prompt: "According to the passage, how does rhythm relate to mathematics?",
        options: [
          { text: "Rhythm uses fractional divisions of beats", isCorrect: true },
          { text: "Rhythm eliminates the need for counting", isCorrect: false },
          { text: "Rhythm is based only on emotion", isCorrect: false },
          { text: "Rhythm depends on random timing", isCorrect: false }
        ]
      },
      {
        prompt: "What is said about harmony in melody?",
        options: [
          { text: "It has no measurable properties", isCorrect: false },
          { text: "It is determined by stage lighting", isCorrect: false },
          { text: "It is linked to frequency ratios", isCorrect: true },
          { text: "It comes only from loud instruments", isCorrect: false }
        ]
      },
      {
        prompt: "How does modern audio software illustrate the music-math connection?",
        options: [
          { text: "It stores sound as data and processes it algorithmically", isCorrect: true },
          { text: "It removes all human creativity", isCorrect: false },
          { text: "It avoids numeric systems entirely", isCorrect: false },
          { text: "It works only with live orchestras", isCorrect: false }
        ]
      },
      {
        prompt: "What classroom example is given in the passage?",
        options: [
          { text: "Students memorize formulas silently", isCorrect: false },
          { text: "Students build instruments from wood", isCorrect: false },
          { text: "Students clap polyrhythms to understand ratios", isCorrect: true },
          { text: "Students skip math while practicing songs", isCorrect: false }
        ]
      },
      {
        prompt: "What is the main conclusion of the passage?",
        options: [
          { text: "Only musicians should study mathematics", isCorrect: false },
          { text: "Music and math can reinforce each other in learning", isCorrect: true },
          { text: "Structure harms creative thinking", isCorrect: false },
          { text: "Math and music must be taught separately", isCorrect: false }
        ]
      }
    ]
  },
  {
    title: "Mangroves: The Quiet Defenders of the Coast",
    theme: "Environment",
    difficultyKey: "medium",
    timeLimitSec: 180,
    content:
      "Mangrove forests grow where rivers meet the sea, in warm coastal regions with salty, shifting water. At first glance, their tangled roots may look chaotic, but this structure is exactly what makes them powerful natural protectors. During storms, mangroves reduce wave energy before it reaches villages and farmland. Their roots trap sediment, helping coastlines resist erosion. They also create nurseries for fish, crabs, and shrimp, supporting local fisheries and food security. Despite these benefits, many mangrove areas have been cleared for construction, aquaculture, and short term development. In places where forests disappeared, coastal communities often became more vulnerable to flooding. Restoration projects show that recovery is possible, but it takes planning and long term commitment. Young mangrove seedlings need the right tidal flow, soil conditions, and protection from disturbance. Scientists now encourage combining engineering with ecosystem restoration rather than relying on concrete barriers alone. A seawall may block water in one location, but healthy mangroves provide broader ecological benefits at the same time. They store large amounts of carbon, filter pollutants, and offer habitat for birds and insects. Protecting mangroves is not only an environmental goal. It is also an economic and social strategy that reduces disaster risk while sustaining livelihoods for coastal populations.",
    questions: [
      {
        prompt: "Why are mangrove roots important according to the passage?",
        options: [
          { text: "They make harvesting timber easier", isCorrect: false },
          { text: "They trap sediment and reduce wave impact", isCorrect: true },
          { text: "They prevent all storms from forming", isCorrect: false },
          { text: "They increase river pollution", isCorrect: false }
        ]
      },
      {
        prompt: "What human activities are mentioned as causes of mangrove loss?",
        options: [
          { text: "Solar power and public transport", isCorrect: false },
          { text: "Construction and aquaculture expansion", isCorrect: true },
          { text: "Rainwater collection and recycling", isCorrect: false },
          { text: "Forest education programs", isCorrect: false }
        ]
      },
      {
        prompt: "What challenge is noted for mangrove restoration?",
        options: [
          { text: "Seedlings grow instantly without planning", isCorrect: false },
          { text: "Recovery needs suitable conditions and long term effort", isCorrect: true },
          { text: "Mangroves can only be restored in cold climates", isCorrect: false },
          { text: "Restoration always fails near communities", isCorrect: false }
        ]
      },
      {
        prompt: "How does the passage compare seawalls and mangroves?",
        options: [
          { text: "Seawalls offer all ecological benefits mangroves provide", isCorrect: false },
          { text: "Mangroves can complement engineering with wider benefits", isCorrect: true },
          { text: "Mangroves are purely decorative compared to seawalls", isCorrect: false },
          { text: "Seawalls are unnecessary in every coastal city", isCorrect: false }
        ]
      },
      {
        prompt: "What broader point is made in the final sentence?",
        options: [
          { text: "Mangrove protection is only about wildlife", isCorrect: false },
          { text: "Mangrove protection supports safety, economy, and livelihoods", isCorrect: true },
          { text: "Mangroves should be replaced with concrete infrastructure", isCorrect: false },
          { text: "Coastal populations should relocate inland immediately", isCorrect: false }
        ]
      }
    ]
  }
];
