type AnswerFeedback = {
  score: number;
  missing: string[];
  strengths: string[];
  suggestion: string;
  fillerCount: number;
};

const includesAny = (text: string, keywords: string[]) =>
  keywords.some((keyword) => text.includes(keyword));

const scoreComponents = (
  text: string,
  components: { name: string; keywords: string[] }[]
) => {
  const missing: string[] = [];
  const strengths: string[] = [];
  let score = 0;

  components.forEach((component) => {
    if (includesAny(text, component.keywords)) {
      strengths.push(component.name);
      score += 1;
    } else {
      missing.push(component.name);
    }
  });

  return {
    score: components.length ? score / components.length : 0,
    missing,
    strengths,
  };
};

const getComponents = (questionType: string) => {
  switch (questionType) {
    case "Behavioral":
      return [
        { name: "Situation", keywords: ["situation", "context", "at the time"] },
        { name: "Task", keywords: ["task", "goal", "responsible"] },
        { name: "Action", keywords: ["i did", "i led", "i built", "i worked"] },
        { name: "Result", keywords: ["result", "impact", "measurable", "%"] },
      ];
    case "System Design":
      return [
        { name: "Requirements", keywords: ["requirements", "users", "scope"] },
        { name: "Architecture", keywords: ["architecture", "components", "services"] },
        { name: "Data", keywords: ["data model", "database", "storage"] },
        { name: "Scaling", keywords: ["scale", "cache", "latency", "shard"] },
        { name: "Tradeoffs", keywords: ["tradeoff", "risk", "cost"] },
      ];
    case "Resume":
      return [
        { name: "Present", keywords: ["currently", "now", "today"] },
        { name: "Past", keywords: ["previous", "before", "earlier"] },
        { name: "Future", keywords: ["next", "looking", "excited"] },
      ];
    case "Opinion":
      return [
        { name: "Thesis", keywords: ["i believe", "i think", "opinion"] },
        { name: "Support", keywords: ["because", "for example", "reason"] },
        { name: "Counterpoint", keywords: ["however", "on the other hand"] },
        { name: "Conclusion", keywords: ["overall", "in summary"] },
      ];
    default:
      return [
        { name: "Problem restate", keywords: ["problem", "we need", "goal"] },
        { name: "Approach", keywords: ["approach", "strategy", "i would"] },
        { name: "Complexity", keywords: ["complexity", "big o", "o("] },
        { name: "Edge cases", keywords: ["edge", "corner", "test"] },
      ];
  }
};

const getSuggestion = (missing: string[], fillerCount: number) => {
  if (missing.length) {
    return `Add ${missing[0]} to complete the framework.`;
  }
  if (fillerCount >= 4) {
    return "Pause between sections to reduce filler words.";
  }
  return "Tighten your answer with one quantified impact.";
};

export async function POST(req: Request) {
  const body = (await req.json()) as {
    answer?: string;
    questionType?: string;
    fillers?: number;
  };

  const answer = body.answer?.toLowerCase().trim() ?? "";
  const questionType = body.questionType ?? "Technical";
  const fillerCount = body.fillers ?? 0;

  if (!answer) {
    return Response.json(
      {
        score: 0,
        missing: ["Answer"],
        strengths: [],
        suggestion: "Provide a full answer to receive feedback.",
        fillerCount,
      } satisfies AnswerFeedback,
      { status: 400 }
    );
  }

  const components = getComponents(questionType);
  const { score, missing, strengths } = scoreComponents(answer, components);
  const suggestion = getSuggestion(missing, fillerCount);

  return Response.json({
    score,
    missing,
    strengths,
    suggestion,
    fillerCount,
  } satisfies AnswerFeedback);
}
