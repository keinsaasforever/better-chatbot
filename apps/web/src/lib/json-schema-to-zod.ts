import { z } from "zod";
import { JSONSchema7 } from "json-schema";

/**
 * Converts a JSON Schema to a Zod schema (simplified version)
 * Supports: string, number, boolean, object, array, enum, default values, basic constraints
 * @param jsonSchema - The JSON Schema object to convert
 * @returns A Zod schema
 */
export function jsonSchemaToZod(jsonSchema: JSONSchema7): z.ZodType<any> {
  // Handle enum
  if (jsonSchema.enum) {
    if (jsonSchema.enum.length === 0) {
      return z.never();
    }
    if (jsonSchema.enum.length === 1) {
      return z.literal(jsonSchema.enum[0] as any);
    }
    const enumSchema = z.enum(jsonSchema.enum as any);

    // Apply default value if present and valid
    if (jsonSchema.default !== undefined) {
      // Check if default value is a valid enum value
      if (jsonSchema.enum.includes(jsonSchema.default)) {
        return enumSchema.default(jsonSchema.default as any);
      }
      // If default value is not in enum, make it optional
      return enumSchema.optional();
    }

    return enumSchema;
  }

  const type = jsonSchema.type;

  switch (type) {
    case "string": {
      let stringSchema = z.string();

      // Apply string constraints
      if (typeof jsonSchema.minLength === "number") {
        stringSchema = stringSchema.min(jsonSchema.minLength);
      }
      if (typeof jsonSchema.maxLength === "number") {
        stringSchema = stringSchema.max(jsonSchema.maxLength);
      }
      if (typeof jsonSchema.pattern === "string") {
        stringSchema = stringSchema.regex(new RegExp(jsonSchema.pattern));
      }

      // Apply default value if present
      if (jsonSchema.default !== undefined) {
        return stringSchema.default(jsonSchema.default as string);
      }

      return stringSchema;
    }

    case "number": {
      let numberSchema = z.number();

      // Apply number constraints
      if (typeof jsonSchema.minimum === "number") {
        numberSchema = numberSchema.min(jsonSchema.minimum);
      }
      if (typeof jsonSchema.maximum === "number") {
        numberSchema = numberSchema.max(jsonSchema.maximum);
      }
      if (typeof jsonSchema.exclusiveMinimum === "number") {
        numberSchema = numberSchema.gt(jsonSchema.exclusiveMinimum);
      }
      if (typeof jsonSchema.exclusiveMaximum === "number") {
        numberSchema = numberSchema.lt(jsonSchema.exclusiveMaximum);
      }
      if (typeof jsonSchema.multipleOf === "number") {
        numberSchema = numberSchema.multipleOf(jsonSchema.multipleOf);
      }

      // Apply default value if present
      if (jsonSchema.default !== undefined) {
        return numberSchema.default(jsonSchema.default as number);
      }

      return numberSchema;
    }

    case "integer": {
      let integerSchema = z.number().int();

      // Apply number constraints
      if (typeof jsonSchema.minimum === "number") {
        integerSchema = integerSchema.min(jsonSchema.minimum);
      }
      if (typeof jsonSchema.maximum === "number") {
        integerSchema = integerSchema.max(jsonSchema.maximum);
      }
      if (typeof jsonSchema.exclusiveMinimum === "number") {
        integerSchema = integerSchema.gt(jsonSchema.exclusiveMinimum);
      }
      if (typeof jsonSchema.exclusiveMaximum === "number") {
        integerSchema = integerSchema.lt(jsonSchema.exclusiveMaximum);
      }
      if (typeof jsonSchema.multipleOf === "number") {
        integerSchema = integerSchema.multipleOf(jsonSchema.multipleOf);
      }

      // Apply default value if present
      if (jsonSchema.default !== undefined) {
        return integerSchema.default(jsonSchema.default as number);
      }

      return integerSchema;
    }

    case "boolean": {
      const booleanSchema = z.boolean();

      // Apply default value if present
      if (jsonSchema.default !== undefined) {
        return booleanSchema.default(jsonSchema.default as boolean);
      }

      return booleanSchema;
    }

    case "array": {
      if (
        !jsonSchema.items ||
        typeof jsonSchema.items === "boolean" ||
        Array.isArray(jsonSchema.items)
      ) {
        let arraySchema = z.array(z.unknown());

        // Apply array constraints
        if (typeof jsonSchema.minItems === "number") {
          arraySchema = arraySchema.min(jsonSchema.minItems);
        }
        if (typeof jsonSchema.maxItems === "number") {
          arraySchema = arraySchema.max(jsonSchema.maxItems);
        }

        // Apply default value if present
        if (jsonSchema.default !== undefined) {
          return arraySchema.default(jsonSchema.default as any[]);
        }

        return arraySchema;
      }

      let arraySchema = z.array(
        jsonSchemaToZod(jsonSchema.items as JSONSchema7),
      );

      // Apply array constraints
      if (typeof jsonSchema.minItems === "number") {
        arraySchema = arraySchema.min(jsonSchema.minItems);
      }
      if (typeof jsonSchema.maxItems === "number") {
        arraySchema = arraySchema.max(jsonSchema.maxItems);
      }

      // Apply default value if present
      if (jsonSchema.default !== undefined) {
        return arraySchema.default(jsonSchema.default as any[]);
      }

      return arraySchema;
    }

    case "object": {
      if (
        !jsonSchema.properties ||
        Object.keys(jsonSchema.properties ?? {}).length === 0
      ) {
        const recordSchema = z.object({}).catchall(z.any());

        // Apply default value if present
        if (jsonSchema.default !== undefined) {
          return recordSchema.default(
            jsonSchema.default as Record<string, any>,
          );
        }

        return recordSchema;
      }

      const shape: Record<string, z.ZodType> = {};
      const required = (jsonSchema.required as string[]) || [];

      for (const [key, propSchema] of Object.entries(jsonSchema.properties)) {
        if (typeof propSchema === "boolean") {
          shape[key] = z.unknown().optional();
          continue;
        }

        let zodProp = jsonSchemaToZod(propSchema);

        // If field has default value, don't make it optional (default will handle undefined)
        // Otherwise, make it optional if not required
        if (propSchema.default === undefined && !required.includes(key)) {
          zodProp = zodProp.optional();
        }

        shape[key] = zodProp;
      }

      const objectSchema = z.object(shape);

      // Apply default value if present
      if (jsonSchema.default !== undefined) {
        return objectSchema.default(jsonSchema.default as Record<string, any>);
      }

      return objectSchema;
    }

    case "null": {
      const nullSchema = z.null();

      // Apply default value if present and is null
      if (jsonSchema.default !== undefined && jsonSchema.default === null) {
        return nullSchema.default(null);
      }

      return nullSchema;
    }

    default: {
      // If type is not specified or unknown, return z.unknown()
      const unknownSchema = z.unknown();

      // Apply default value if present
      if (jsonSchema.default !== undefined) {
        return unknownSchema.default(jsonSchema.default);
      }

      return unknownSchema;
    }
  }
}

/**
 * Converts a JSON Schema string to a Zod schema
 * @param jsonSchemaString - The JSON Schema as a string
 * @returns A Zod schema
 */
export function jsonSchemaStringToZod(
  jsonSchemaString: string,
): z.ZodType<any> {
  try {
    const jsonSchema = JSON.parse(jsonSchemaString) as JSONSchema7;
    return jsonSchemaToZod(jsonSchema);
  } catch (error) {
    throw new Error(`Failed to parse JSON Schema: ${error}`);
  }
}
