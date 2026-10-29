import { safe } from "ts-safe";
import { OutputSchemaSourceKey } from "./workflow.interface";

/**
 * Condition operators for string-based comparisons.
 * Used to evaluate string values from node outputs.
 */
export enum StringConditionOperator {
  Equals = "equals",
  NotEquals = "not_equals",
  Contains = "contains",
  NotContains = "not_contains",
  StartsWith = "starts_with",
  EndsWith = "ends_with",
  IsEmpty = "is_empty",
  IsNotEmpty = "is_not_empty",
}

/**
 * Condition operators for number-based comparisons.
 * Inherits string equality operators and adds numeric comparisons.
 */
export enum NumberConditionOperator {
  Equals = StringConditionOperator.Equals,
  NotEquals = StringConditionOperator.NotEquals,
  GreaterThan = "greater_than",
  LessThan = "less_than",
  GreaterThanOrEqual = "greater_than_or_equal",
  LessThanOrEqual = "less_than_or_equal",
}

/**
 * Condition operators for boolean value testing.
 */
export enum BooleanConditionOperator {
  IsTrue = "is_true",
  IsFalse = "is_false",
}

/**
 * Gets the default condition operator for a given data type.
 * Used when creating new conditions in the UI.
 */
export function getFirstConditionOperator(
  type: "string" | "number" | "boolean",
) {
  switch (type) {
    case "string":
      return StringConditionOperator.Equals;
    case "number":
      return NumberConditionOperator.Equals;
    case "boolean":
      return BooleanConditionOperator.IsTrue;
    default:
      return StringConditionOperator.Equals;
  }
}

/**
 * Union type of all possible condition operators.
 */
export type ConditionOperator =
  | StringConditionOperator
  | NumberConditionOperator
  | BooleanConditionOperator;

/**
 * A single condition rule that compares a value from a node output
 * with a target value using a specified operator.
 */
export type ConditionRule = {
  source: OutputSchemaSourceKey; // Reference to another node's output field
  operator: ConditionOperator;
  value?: string | number | boolean; // Comparison value (not needed for is_empty, is_not_empty, is_true, is_false)
};

/**
 * A condition branch for if-elseIf-else structure.
 * Each branch can have multiple conditions combined with AND/OR logic.
 */
export type ConditionBranch = {
  id: "if" | "else" | (string & {});
  type: "if" | "elseIf" | "else";
  conditions: ConditionRule[]; // Not needed for 'else' type
  logicalOperator: "AND" | "OR"; // How to combine multiple conditions, not needed for 'else'
};

/**
 * Complete condition structure supporting if-elseIf-else branching.
 * Used by Condition nodes to determine execution flow.
 */
export type ConditionBranches = {
  if: ConditionBranch;
  elseIf?: ConditionBranch[]; // Optional multiple elseIf branches
  else: ConditionBranch; // Optional else branch
};

/**
 * Evaluates a condition branch to determine if it should be executed.
 *
 * @param branch - The condition branch to evaluate
 * @param getSourceValue - Function to get values from node outputs
 * @returns True if the branch conditions are met
 */
export function checkConditionBranch(
  branch: ConditionBranch,
  getSourceValue: (
    source: OutputSchemaSourceKey,
  ) => string | number | boolean | undefined,
): boolean {
  // Evaluate all conditions in the branch
  const results = branch.conditions?.map((condition) => {
    return checkConditionRule({
      operator: condition.operator,
      target: String(condition.value || ""),
      source: getSourceValue(condition.source),
    });
  }) ?? [false];

  // Combine results based on logical operator
  if (branch.logicalOperator === "AND") {
    return results.every((result) => result);
  }
  return results.some((result) => result);
}

/**
 * Evaluates a single condition rule.
 *
 * @param params - The condition rule parameters
 * @returns True if the condition is met
 */
function checkConditionRule({
  operator,
  target,
  source,
}: {
  operator: ConditionOperator;
  target: string;
  source?: string | number | boolean;
}): boolean {
  return safe(() => {
    switch (operator) {
      case StringConditionOperator.Equals:
        if (source == target) return true;
        break;
      case StringConditionOperator.NotEquals:
        if (source != target) return true;
        break;
      case StringConditionOperator.Contains:
        if (String(source).includes(String(target))) return true;
        break;
      case StringConditionOperator.NotContains:
        if (!String(source).includes(String(target))) return true;
        break;
      case StringConditionOperator.StartsWith:
        if (String(source).startsWith(String(target))) return true;
        break;
      case StringConditionOperator.EndsWith:
        if (String(source).endsWith(String(target))) return true;
        break;
      case StringConditionOperator.IsEmpty:
        if (!source) return true;
        break;
      case StringConditionOperator.IsNotEmpty:
        if (source) return true;
        break;
      case NumberConditionOperator.GreaterThan:
        if (Number(source) > Number(target)) return true;
        break;
      case NumberConditionOperator.LessThan:
        if (Number(source) < Number(target)) return true;
        break;
      case NumberConditionOperator.GreaterThanOrEqual:
        if (Number(source) >= Number(target)) return true;
        break;
      case NumberConditionOperator.LessThanOrEqual:
        if (Number(source) <= Number(target)) return true;
        break;
      case BooleanConditionOperator.IsTrue:
        if (source) return true;
        break;
      case BooleanConditionOperator.IsFalse:
        if (!source) return true;
        break;
    }
    return false;
  })
    .ifFail((e) => {
      console.error("Condition evaluation error:", e);
      return false;
    })
    .unwrap();
}
