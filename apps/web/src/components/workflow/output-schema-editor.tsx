"use client";

import { ObjectJsonSchema7 } from "app-types/util";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "ui/dialog";
import { Button } from "ui/button";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import {
  PlusIcon,
  TrashIcon,
  WandSparklesIcon,
  CodeIcon,
  FileTextIcon,
  PencilIcon,
  VariableIcon,
} from "lucide-react";
import {
  EditJsonSchemaFieldPopup,
  Feild,
} from "../edit-json-schema-field-popup";
import { useState, useCallback, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { generateObjectAction } from "@/app/api/chat/actions";
import { appStore } from "@/app/store";
import { SelectModel } from "../select-model";
import { notify } from "lib/notify";
import { useTranslations } from "next-intl";
import { JSONSchema7 } from "json-schema";
import { defaultObjectJsonSchema } from "lib/ai/workflow/shared.workflow";
import { errorToString, validateSchema } from "lib/utils";
import { safe } from "ts-safe";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";

type SchemaEditMode = "simple" | "advanced";

interface OutputSchemaEditorProps {
  children: React.ReactNode;
  onChange: (schema: ObjectJsonSchema7) => void;
  schema?: ObjectJsonSchema7;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const isObjectJsonSchema7 = (schema: any): schema is ObjectJsonSchema7 => {
  if (!schema) return false;
  return schema.type === "object";
};

const placeholderJsonSchema = `{
  "type": "object",
  "properties": {
    "result": {
      "type": "string",
      "description": "The result of the operation"
    },
    "status": {
      "type": "number",
      "description": "HTTP status code"
    },
    "data": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {"type": "string"}
        },
        "count": {"type": "number"}
      }
    }
  },
  "required": ["result", "status"]
}`;

export function OutputSchemaEditor({
  children,
  onChange,
  schema,
  open,
  onOpenChange,
}: OutputSchemaEditorProps) {
  const t = useTranslations();
  const [mode, setMode] = useState<SchemaEditMode>("simple");
  const [localSchema, setLocalSchema] = useState<ObjectJsonSchema7>(
    structuredClone(defaultObjectJsonSchema),
  );
  const [advancedJson, setAdvancedJson] = useState("");

  const fields = useMemo(() => {
    const properties = localSchema.properties || {};
    return Object.entries(properties).map(([key, value]) => ({
      key,
      type: getFieldType(value),
      required: localSchema.required?.includes(key) || false,
      description: (value as any).description,
      enum: (value as any).enum,
      defaultValue: (value as any).default,
    }));
  }, [localSchema]);

  const handleSave = () => {
    const isDirectTab = mode === "advanced";
    if (isDirectTab) {
      const isValid = validate(advancedJson);
      if (!isValid) return;
    }
    onChange(isDirectTab ? JSON.parse(advancedJson) : localSchema);
    onOpenChange?.(false);
  };

  const validate = useCallback((json: string): boolean => {
    return safe(() => JSON.parse(json) as ObjectJsonSchema7)
      .map((s) => {
        if (!isObjectJsonSchema7(s))
          throw new Error("Root schema must be an object");
        validateSchema("answer", s);
        jsonSchemaToZod(s); // for checking if the schema is valid
        return true;
      })
      .ifFail((e) => {
        toast.error(errorToString(e));
        return false;
      })
      .orElse(false);
  }, []);

  const handleGenerateWithAI = useCallback(async () => {
    let model = appStore.getState().chatModel;
    const result = await notify.prompt({
      title: t("Workflow.generateSchemaWithAI"),
      description: (
        <div className="flex items-center gap-2">
          <p className="mr-auto whitespace-pre-wrap">
            {t("Workflow.describeOutputDataRequest", {
              eg: '{"name": "John", "age": 30}',
            })}
          </p>
          <SelectModel
            onSelect={(m) => {
              model = m;
            }}
          />
        </div>
      ),
    });
    if (!result) return;
    toast.promise(
      generateObjectAction({
        model,
        prompt: {
          system: `You are an expert JSON Schema Draft 7 generator for workflow automation systems.

Your task is to generate a comprehensive JSON Schema based on the user's input. Handle two types of input:

1. **Example JSON Data**: If the user provides JSON data, analyze it and generate a schema that validates that structure.

2. **Natural Language Description**: If the user describes what they want (not JSON), follow these steps:
   - First, identify the main data class/entity from their description
   - Think about what properties this entity should have
   - Consider realistic data types and structure for that domain
   - Generate an appropriate JSON Schema for that concept

Key Guidelines:
- The root schema type is ALWAYS "object" (workflow nodes output object data by default)
- Include meaningful "description" fields for each property
- Mark essential fields as "required" based on context
- Use appropriate JSON Schema data types: string, number, boolean, array, object
- For arrays, create proper "items" schemas
- For nested objects, create proper "properties" definitions
- Focus on creating schemas that enable rich data flow between workflow nodes

Examples:

JSON Data Input: {"name": "John", "age": 25}
Output: {
  "type": "object",
  "properties": {
    "name": {"type": "string", "description": "Person's name"},
    "age": {"type": "number", "description": "Person's age"}
  },
  "required": ["name", "age"]
}

Natural Language Input: "User profile data"
Output: {
  "type": "object",
  "properties": {
    "id": {"type": "string", "description": "Unique user identifier"},
    "name": {"type": "string", "description": "User's full name"},
    "email": {"type": "string", "description": "User's email address"},
    "createdAt": {"type": "string", "description": "Account creation timestamp"}
  },
  "required": ["id", "name", "email"]
}

Return ONLY the JSON Schema object - no explanations or markdown formatting.`,
          user: result,
        },
        schema: {
          type: "object",
          description: "JSON Schema7",
          properties: {},
          additionalProperties: true,
        },
      }).then((res) => {
        setAdvancedJson(JSON.stringify(res, null, 2));
      }),
      {
        loading: t("Workflow.generatingJsonSchemaWithAI"),
        success: t("Workflow.jsonSchemaGeneratedSuccessfully"),
        error: t("Workflow.failedToGenerateSchema"),
      },
    );
  }, [t]);

  const updateField = useCallback(
    (index: number, field: Feild) => {
      const newProperties = { ...localSchema.properties };
      const oldKey = fields[index]?.key;

      if (oldKey && oldKey !== field.key) {
        delete newProperties[oldKey];
      }

      newProperties[field.key] = {
        type: field.type,
        ...(field.description && { description: field.description }),
        ...(field.enum && { enum: field.enum }),
        ...(field.defaultValue !== undefined && {
          default: field.defaultValue,
        }),
      };

      const newRequired =
        localSchema.required?.filter((key) => key !== oldKey) || [];
      if (field.required && !newRequired.includes(field.key)) {
        newRequired.push(field.key);
      }

      setLocalSchema({
        ...localSchema,
        properties: newProperties,
        required: newRequired.length > 0 ? newRequired : undefined,
      });
    },
    [fields, localSchema],
  );

  const removeField = useCallback(
    (key: string) => {
      const newProperties = { ...localSchema.properties };
      delete newProperties[key];

      const newRequired = localSchema.required?.filter((k) => k !== key);

      setLocalSchema({
        ...localSchema,
        properties: newProperties,
        required: newRequired?.length ? newRequired : undefined,
      });
    },
    [localSchema],
  );

  useEffect(() => {
    if (open) {
      const is = isObjectJsonSchema7(schema);
      setLocalSchema(is ? schema : structuredClone(defaultObjectJsonSchema));
      setMode("simple");
      setAdvancedJson(is ? JSON.stringify(schema, null, 2) : "");
    }
  }, [open, schema]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("Workflow.outputSchemaEditor")}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as SchemaEditMode)}
            className="h-full flex flex-col"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="simple" className="flex items-center gap-2">
                <FileTextIcon className="h-4 w-4" />
                Simple
              </TabsTrigger>
              <TabsTrigger value="advanced" className="flex items-center gap-2">
                <CodeIcon className="h-4 w-4" />
                JSON Schema
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden mt-4 min-h-80">
              <TabsContent value="simple" className="h-full overflow-y-auto">
                <Card className="border-none bg-transparent">
                  <CardHeader className="sr-only">
                    <CardTitle>Schema Fields</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-0!">
                    {fields.map((field, index) => (
                      <div
                        key={field.key || index}
                        className="flex items-center border rounded-lg px-4 py-2"
                      >
                        <VariableIcon className="size-4 text-blue-500" />
                        <div className="flex-1 flex items-center gap-2 text-sm">
                          <div className="text-muted-foreground w-12">
                            {field.type}
                          </div>
                          <div>
                            <span className="font-medium truncate">
                              {field.key || "unnamed"}
                            </span>
                            {field.required && (
                              <span className="text-destructive ml-1">*</span>
                            )}
                          </div>
                        </div>
                        {["string", "number", "boolean"].includes(
                          field.type,
                        ) && (
                          <EditJsonSchemaFieldPopup
                            field={field}
                            onChange={(updatedField) =>
                              updateField(index, updatedField)
                            }
                          >
                            <Button variant="ghost" size="icon">
                              <PencilIcon />
                            </Button>
                          </EditJsonSchemaFieldPopup>
                        )}

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeField(field.key)}
                          className="hover:text-destructive"
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                    ))}

                    <EditJsonSchemaFieldPopup
                      onChange={(field) => {
                        const newProperties = { ...localSchema.properties };
                        newProperties[field.key] = {
                          type: field.type,
                          ...(field.description && {
                            description: field.description,
                          }),
                          ...(field.enum && { enum: field.enum }),
                          ...(field.defaultValue !== undefined && {
                            default: field.defaultValue,
                          }),
                        };

                        const newRequired = localSchema.required || [];
                        if (
                          field.required &&
                          !newRequired.includes(field.key)
                        ) {
                          newRequired.push(field.key);
                        }

                        setLocalSchema({
                          ...localSchema,
                          properties: newProperties,
                          required:
                            newRequired.length > 0 ? newRequired : undefined,
                        });
                      }}
                    >
                      <Button
                        variant="outline"
                        className="w-full border-dashed"
                      >
                        <PlusIcon className="mr-2" />
                        {t("Workflow.addField")}
                      </Button>
                    </EditJsonSchemaFieldPopup>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="advanced" className="h-full overflow-y-auto">
                <Card className="border-none bg-transparent">
                  <CardHeader>
                    <CardTitle>JSON Schema Editor</CardTitle>
                    <CardDescription className="text-sm text-muted-foreground">
                      {t("Workflow.jsonSchemaEditorDescription")}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="px-0">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label htmlFor="advanced-json">
                          JSON Schema (Draft 7)
                        </Label>
                        <Button
                          onClick={handleGenerateWithAI}
                          variant="outline"
                          size="sm"
                        >
                          <WandSparklesIcon className="size-3.5 mr-2" />
                          {t("Common.generateWithAI")}
                        </Button>
                      </div>
                      <Textarea
                        id="advanced-json"
                        className="min-h-[300px] font-mono text-sm resize-none max-h-[400px] overflow-y-auto"
                        placeholder={placeholderJsonSchema}
                        value={advancedJson}
                        onChange={(e) => setAdvancedJson(e.target.value)}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("Common.cancel")}</Button>
          </DialogClose>
          <Button onClick={handleSave}>{t("Workflow.saveSchema")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Helper functions
function getFieldType(schema: JSONSchema7): "string" | "number" | "boolean" {
  if (schema.type === "string" && schema.enum) return "string"; // enum is treated as string
  return (schema.type as "string" | "number" | "boolean") || "string";
}
