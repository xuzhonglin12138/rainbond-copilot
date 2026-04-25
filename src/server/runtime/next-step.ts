export interface RunAgainNextStep {
  type: "run_again";
}

export interface InterruptionNextStep {
  type: "interruption";
}

export interface FinalOutputNextStep {
  type: "final_output";
}

export interface FailedNextStep {
  type: "failed";
}

export type NextStep =
  | RunAgainNextStep
  | InterruptionNextStep
  | FinalOutputNextStep
  | FailedNextStep;
