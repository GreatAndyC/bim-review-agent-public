import type { Metadata } from "next";
import { ReviewApp } from "./components/review-app";

export const metadata: Metadata = {
  description:
    "Upload a real IFC and run a bounded Site-contained Agent with deterministic rules, dual evidence, an auditable trace, and canonical JSON export.",
  other: {
    "codex-preview": "development",
  },
};

export default function Home() {
  return <ReviewApp />;
}
