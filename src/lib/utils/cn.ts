import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class strings, letting later classes win over earlier ones on
 * the same property.
 *
 * This lives in the package rather than in each app because the primitives in
 * `components/ui` depend on it: a primitive builds a base class string and the
 * caller overrides part of it via `className`, and that override only works if
 * `twMerge` understands both. Two copies of `tailwind-merge` on different
 * versions could resolve the same pair of classes differently in an app
 * component than in a primitive, which is the exact class of silent drift this
 * package exists to remove.
 *
 * `clsx` and `tailwind-merge` are real dependencies, not peers: they are pure
 * string functions with no shared instance state and nothing about them appears
 * in this package's public types, so a duplicate install would be harmless
 * rather than broken. Requiring the consumer to install them would just make a
 * self-contained package fail to work out of the box.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
