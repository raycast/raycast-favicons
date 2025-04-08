import { z } from "zod";

export const urlSchema = () =>
  z
    .string()
    .refine(
      (data) => {
        try {
          new URL(data);
          return true;
        } catch {
          return false;
        }
      },
      {
        message: "Invalid URL",
      }
    )
    .transform((data) => new URL(data));
