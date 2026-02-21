type AnalysisResult = {
  questionType: string;
  framework: string[];
  outline: string[];
  notes?: string;
};

const detectQuestionType = (text: string) => {
  const lowered = text.toLowerCase();
  if (
    lowered.includes("tell me about a time") ||
    lowered.includes("when did you") ||
    lowered.includes("conflict") ||
    lowered.includes("challenge") ||
    lowered.includes("failed")
  ) {
    return "Behavioral";
  }
  if (
    lowered.includes("design") ||
    lowered.includes("scale") ||
    lowered.includes("architecture") ||
    lowered.includes("system") ||
    lowered.includes("traffic")
  ) {
    return "System Design";
  }
  if (
    lowered.includes("resume") ||
    lowered.includes("background") ||
    lowered.includes("experience") ||
    lowered.includes("tell me about yourself")
  ) {
    return "Resume";
  }
  if (
    lowered.includes("opinion") ||
    lowered.includes("think about") ||
    lowered.includes("should we") ||
    lowered.includes("would you")
  ) {
    return "Opinion";
  }
  return "Technical";
};

const getFramework = (questionType: string): AnalysisResult => {
  switch (questionType) {
    case "Behavioral":
      return {
        questionType,
        framework: ["Situation", "Task", "Action", "Result"],
        outline: [
          "Set the scene with a short context",
          "Explain your responsibility or goal",
          "Walk through the key actions you took",
          "End with measurable results or learnings",
        ],
      };
    case "System Design":
      return {
        questionType,
        framework: [
          "Clarify",
          "Requirements",
          "High-level Design",
          "Data Model",
          "Scaling",
          "Tradeoffs",
        ],
        outline: [
          "Clarify scope, users, and constraints",
          "List functional and non-functional requirements",
          "Sketch a high-level architecture",
          "Define data model and APIs",
          "Discuss scaling, caching, and bottlenecks",
          "Call out tradeoffs and risks",
        ],
      };
    case "Resume":
      return {
        questionType,
        framework: ["Present", "Past", "Future"],
        outline: [
          "Start with your current role and focus",
          "Connect 1-2 past highlights to the role",
          "Close with what you want next and why",
        ],
      };
    case "Opinion":
      return {
        questionType,
        framework: ["Thesis", "Support", "Counterpoint", "Conclusion"],
        outline: [
          "State your opinion in one sentence",
          "Give 2-3 supporting points or examples",
          "Acknowledge a counterpoint and respond",
          "Wrap with a clear recommendation",
        ],
      };
    default:
      return {
        questionType,
        framework: ["Problem", "Approach", "Complexity", "Edge Cases"],
        outline: [
          "Restate the problem and assumptions",
          "Explain your approach step-by-step",
          "Mention time/space complexity",
          "Cover edge cases and tests",
        ],
      };
  }
};

const callExternalLLM = async (text: string): Promise<AnalysisResult> => {
  const url = process.env.LLM_API_URL;
  if (!url) return getFramework(detectQuestionType(text));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.LLM_API_KEY
        ? `Bearer ${process.env.LLM_API_KEY}`
        : "",
    },
    body: JSON.stringify({
      prompt: `Classify the question type and return JSON with keys questionType, framework (array), outline (array).\nQuestion: ${text}`,
    }),
  });

  if (!response.ok) {
    return getFramework(detectQuestionType(text));
  }

  const data = (await response.json()) as AnalysisResult;
  if (!data.questionType || !data.framework || !data.outline) {
    return getFramework(detectQuestionType(text));
  }
  return data;
};

export async function POST(req: Request) {
  const startTime = Date.now();
  const body = (await req.json()) as { transcript?: string };
  const transcript = body?.transcript?.trim() ?? "";

  if (!transcript) {
    return Response.json(
      { error: "Transcript is required" },
      { status: 400 }
    );
  }

  const result = await callExternalLLM(transcript);
  const latency = Date.now() - startTime;

  return Response.json({ result, latency });
}
