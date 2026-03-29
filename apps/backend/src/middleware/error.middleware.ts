import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";

export function errorMiddleware(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
) {
  if (error instanceof ZodError) {
    return response.status(400).json({
      message: "אימות הנתונים נכשל.",
      issues: error.flatten(),
    });
  }

  if (error instanceof HttpError) {
    return response.status(error.statusCode).json({
      message: error.message,
      details: error.details,
    });
  }

  logger.error({ error }, "Unhandled request error");

  return response.status(500).json({
    message: "אירעה שגיאה פנימית בשרת.",
  });
}
