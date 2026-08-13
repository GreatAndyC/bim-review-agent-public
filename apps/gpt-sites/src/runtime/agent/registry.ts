import type {
  AgentStopReason,
  JsonObject,
  ToolDescriptor,
} from "../../contracts/agent";
import { requireJsonObject } from "./actions";

export type ToolValidator = (value: unknown) => JsonObject;
export type ToolHandler<Context> = (
  input: JsonObject,
  context: Context,
) => JsonObject | Promise<JsonObject>;

export type RegisteredTool<Context> = {
  descriptor: ToolDescriptor;
  validate_input: ToolValidator;
  validate_output: ToolValidator;
  handler: ToolHandler<Context>;
  canonical_review_output_key?: string;
  public_observation?: (output: JsonObject) => JsonObject;
};

export type ToolExecution = {
  output: JsonObject;
  public_output: JsonObject;
  canonical_review_run_id: string | null;
};

export class ToolDispatchError extends Error {
  constructor(
    readonly reason: AgentStopReason,
    message: string,
  ) {
    super(message);
    this.name = "ToolDispatchError";
  }
}

export class ToolRegistry<Context> {
  readonly #tools = new Map<string, RegisteredTool<Context>>();

  register(tool: RegisteredTool<Context>): void {
    if (this.#tools.has(tool.descriptor.name)) {
      throw new Error(`Tool already registered: ${tool.descriptor.name}`);
    }
    this.#tools.set(tool.descriptor.name, tool);
  }

  contains(name: string): boolean {
    return this.#tools.has(name);
  }

  isCanonicalReviewTool(name: string): boolean {
    return Boolean(this.#tools.get(name)?.canonical_review_output_key);
  }

  catalogue(allowedTools: readonly string[]): ToolDescriptor[] {
    const allowed = new Set(allowedTools);
    return Array.from(this.#tools.values())
      .filter((tool) => allowed.has(tool.descriptor.name))
      .sort((left, right) =>
        left.descriptor.name.localeCompare(right.descriptor.name, "en"),
      )
      .map((tool) => structuredClone(tool.descriptor));
  }

  async execute(
    name: string,
    argumentsValue: JsonObject,
    context: Context,
  ): Promise<ToolExecution> {
    const tool = this.#tools.get(name);
    if (!tool) {
      throw new ToolDispatchError(
        "TOOL_NOT_FOUND",
        `Requested tool is not registered: ${name}`,
      );
    }

    let input: JsonObject;
    try {
      input = tool.validate_input(argumentsValue);
    } catch {
      throw new ToolDispatchError(
        "TOOL_INPUT_INVALID",
        `Input for tool ${name} does not match its declared schema.`,
      );
    }

    let rawOutput: unknown;
    try {
      rawOutput = await tool.handler(input, context);
    } catch (error) {
      if (error instanceof ToolDispatchError) throw error;
      throw new ToolDispatchError(
        "TOOL_EXECUTION_FAILED",
        `Tool ${name} failed during execution.`,
      );
    }

    let output: JsonObject;
    try {
      output = requireJsonObject(tool.validate_output(rawOutput));
    } catch {
      throw new ToolDispatchError(
        "TOOL_OUTPUT_INVALID",
        `Output from tool ${name} does not match its declared schema.`,
      );
    }

    const outputKey = tool.canonical_review_output_key;
    const candidate = outputKey ? output[outputKey] : null;
    if (outputKey && (typeof candidate !== "string" || !candidate)) {
      throw new ToolDispatchError(
        "TOOL_OUTPUT_INVALID",
        `Output from tool ${name} did not identify its canonical ReviewRun.`,
      );
    }
    let publicOutput: JsonObject;
    try {
      publicOutput = requireJsonObject(
        tool.public_observation ? tool.public_observation(output) : output,
      );
    } catch {
      throw new ToolDispatchError(
        "TOOL_OUTPUT_INVALID",
        `Public observation from tool ${name} does not match its bounded contract.`,
      );
    }
    return {
      output,
      public_output: publicOutput,
      canonical_review_run_id: typeof candidate === "string" ? candidate : null,
    };
  }
}
