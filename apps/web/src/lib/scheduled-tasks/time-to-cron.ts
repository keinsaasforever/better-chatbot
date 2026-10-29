/**
 * Converts user-friendly schedule inputs to cron expressions
 */

export type ScheduleFrequency = "hourly" | "daily" | "weekly" | "monthly";

export interface ScheduleInput {
  frequency: ScheduleFrequency;
  time?: string; // "HH:MM" format (not used for hourly)
  dayOfWeek?: number; // 0-6 (Sunday-Saturday) for weekly
  dayOfMonth?: number; // 1-31 for monthly
  timezone: string;
}

/**
 * Convert schedule input to cron expression
 * Cron format: minute hour day month dayOfWeek
 */
export function timeToCron(input: ScheduleInput): string {
  const { frequency, time, dayOfWeek, dayOfMonth } = input;

  // For hourly: run at minute 0 of every hour
  if (frequency === "hourly") {
    return "0 * * * *";
  }

  if (!time) {
    throw new Error("Time is required for non-hourly schedules");
  }

  const [hours, minutes] = time.split(":").map(Number);

  if (isNaN(hours) || isNaN(minutes)) {
    throw new Error("Invalid time format. Use HH:MM");
  }

  switch (frequency) {
    case "daily":
      return `${minutes} ${hours} * * *`;

    case "weekly":
      if (dayOfWeek === undefined) {
        throw new Error("Day of week is required for weekly schedule");
      }
      return `${minutes} ${hours} * * ${dayOfWeek}`;

    case "monthly":
      if (dayOfMonth === undefined) {
        throw new Error("Day of month is required for monthly schedule");
      }
      return `${minutes} ${hours} ${dayOfMonth} * *`;

    default:
      throw new Error(`Unsupported frequency: ${frequency}`);
  }
}

/**
 * Parse cron expression to human-readable format
 */
export function cronToHumanReadable(cron: string, timezone: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) {
    return "Invalid cron expression";
  }

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  // Hourly
  if (hour === "*" && minute === "0") {
    return `Every hour (${timezone})`;
  }

  // Daily
  if (dayOfMonth === "*" && dayOfWeek === "*") {
    return `Daily at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")} (${timezone})`;
  }

  // Weekly
  if (dayOfMonth === "*" && dayOfWeek !== "*") {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dayName = days[Number.parseInt(dayOfWeek)] || "Unknown";
    return `Every ${dayName} at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")} (${timezone})`;
  }

  // Monthly
  if (dayOfMonth !== "*" && dayOfWeek === "*") {
    const suffix =
      dayOfMonth === "1"
        ? "st"
        : dayOfMonth === "2"
          ? "nd"
          : dayOfMonth === "3"
            ? "rd"
            : "th";
    return `Monthly on the ${dayOfMonth}${suffix} at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")} (${timezone})`;
  }

  return `${cron} (${timezone})`;
}

/**
 * Get user's timezone (defaults to UTC if detection fails)
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * Get list of common timezones for selection
 */
export function getCommonTimezones(): Array<{ value: string; label: string }> {
  return [
    { value: "UTC", label: "UTC" },
    { value: "America/New_York", label: "Eastern Time (US)" },
    { value: "America/Chicago", label: "Central Time (US)" },
    { value: "America/Denver", label: "Mountain Time (US)" },
    { value: "America/Los_Angeles", label: "Pacific Time (US)" },
    { value: "Europe/London", label: "London" },
    { value: "Europe/Paris", label: "Paris" },
    { value: "Europe/Berlin", label: "Berlin" },
    { value: "Asia/Tokyo", label: "Tokyo" },
    { value: "Asia/Shanghai", label: "Shanghai" },
    { value: "Asia/Singapore", label: "Singapore" },
    { value: "Australia/Sydney", label: "Sydney" },
  ];
}

/**
 * Parse cron expression back to schedule input (for editing)
 */
export function cronToScheduleInput(
  cron: string,
): Partial<ScheduleInput> | null {
  const parts = cron.split(" ");
  if (parts.length !== 5) {
    return null;
  }

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  // Hourly: 0 * * * *
  if (hour === "*" && minute === "0") {
    return { frequency: "hourly" };
  }

  // Daily: ${minute} ${hour} * * *
  if (dayOfMonth === "*" && dayOfWeek === "*") {
    return {
      frequency: "daily",
      time: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`,
    };
  }

  // Weekly: ${minute} ${hour} * * ${dayOfWeek}
  if (dayOfMonth === "*" && dayOfWeek !== "*") {
    return {
      frequency: "weekly",
      time: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`,
      dayOfWeek: parseInt(dayOfWeek),
    };
  }

  // Monthly: ${minute} ${hour} ${dayOfMonth} * *
  if (dayOfMonth !== "*" && dayOfWeek === "*") {
    return {
      frequency: "monthly",
      time: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`,
      dayOfMonth: parseInt(dayOfMonth),
    };
  }

  return null;
}
