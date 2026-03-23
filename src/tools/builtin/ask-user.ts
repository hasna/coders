/**
 * AskUserQuestion tool — multi-choice user prompting
 *
 * Presents structured questions with options for the user to select.
 * Used during planning and requirement clarification.
 */
import { z } from "zod";
import type { Tool, ToolCallResult, ToolResultBlockParam } from "../interface.js";
import { ASK_USER_QUESTION_TOOL, DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../core/constants.js";

// ── Schemas ────────────────────────────────────────────────────────

const OptionSchema = z.object({
  label: z.string().describe("Display text (1-5 words)"),
  description: z.string().describe("Explanation of what this option means"),
  preview: z.string().optional().describe("Optional preview content when focused"),
});

const QuestionSchema = z.object({
  question: z.string().describe("The complete question to ask"),
  header: z.string().max(30).describe("Short label displayed as a chip/tag"),
  options: z.array(OptionSchema).min(2).max(4).describe("2-4 available choices"),
  multiSelect: z.boolean().default(false).describe("Allow multiple selections"),
});

const AskUserInputSchema = z.strictObject({
  questions: z.array(QuestionSchema).min(1).max(4).describe("1-4 questions to ask"),
  answers: z.record(z.string(), z.string()).optional().describe("Pre-filled answers from permission UI"),
  annotations: z.record(z.string(), z.object({
    preview: z.string().optional(),
    notes: z.string().optional(),
  })).optional().describe("Per-question annotations"),
});

type AskUserInput = z.infer<typeof AskUserInputSchema>;

interface AskUserOutput {
  questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }> }>;
  answers: Record<string, string>;
  annotations?: Record<string, { preview?: string; notes?: string }>;
}

const AskUserOutputSchema = z.object({
  questions: z.array(z.object({
    question: z.string(),
    header: z.string(),
    options: z.array(z.object({ label: z.string(), description: z.string() })),
  })),
  answers: z.record(z.string(), z.string()),
  annotations: z.record(z.string(), z.object({ preview: z.string().optional(), notes: z.string().optional() })).optional(),
});

// ── AskUserQuestion Tool ───────────────────────────────────────────

export const askUserQuestionTool: Tool<AskUserInput, AskUserOutput> = {
  name: ASK_USER_QUESTION_TOOL,
  searchHint: "prompt the user with a multiple-choice question",
  maxResultSizeChars: DEFAULT_MAX_RESULT_SIZE_CHARS,
  shouldDefer: true,

  async description() { return "Ask the user a structured question"; },
  async prompt() { return ASK_USER_PROMPT; },

  get inputSchema() { return AskUserInputSchema; },
  get outputSchema() { return AskUserOutputSchema; },

  userFacingName() { return ""; },
  isEnabled() { return true; },
  isConcurrencySafe() { return true; },
  isReadOnly() { return false; },
  toAutoClassifierInput(input) { return input.questions.map(q => q.question).join(" | "); },
  requiresUserInteraction() { return true; },

  async validateInput(input) {
    const questions = input.questions.map(q => q.question);
    if (questions.length !== new Set(questions).size) {
      return { result: false, message: "Question texts must be unique", errorCode: 1 };
    }
    for (const q of input.questions) {
      const labels = q.options.map(o => o.label);
      if (labels.length !== new Set(labels).size) {
        return { result: false, message: `Option labels must be unique within each question: "${q.question}"`, errorCode: 2 };
      }
    }
    return { result: true };
  },

  async checkPermissions(input) {
    return { behavior: "ask", message: "Answer questions?", updatedInput: input };
  },

  async call(input): Promise<ToolCallResult<AskUserOutput>> {
    // The answers are filled in by the permission UI (interactive picker in app.tsx)
    const answers = input.answers ?? {};
    const hasAnswers = Object.keys(answers).length > 0;
    return {
      data: {
        questions: input.questions,
        answers,
        annotations: input.annotations,
      },
      error: hasAnswers ? undefined : "User skipped the questions (pressed Escape). Try rephrasing or proceeding with defaults.",
    };
  },

  mapToolResultToToolResultBlockParam(result, toolUseId) {
    const answerStr = Object.entries(result.answers)
      .map(([q, a]) => `"${q}" = "${a}"`)
      .join(", ");

    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: `User has answered your questions: ${answerStr}. You can now continue with the user's answers in mind.`,
    };
  },
};

// ── Prompt ─────────────────────────────────────────────────────────

const ASK_USER_PROMPT = `Present structured questions with multiple-choice options to the user.

Use this tool when you need clarification on:
- Input/output formats, user preferences between approaches
- Priority/scope decisions, integration requirements
- Architecture-affecting decisions, unclear requirements

Guidelines:
- 1-4 questions per call, each with 2-4 options
- Keep labels concise (1-5 words), use descriptions for details
- Unique question texts and option labels
- Use multiSelect when choices are not mutually exclusive`;
