import { notFound } from "next/navigation";

// Unknown URLs inside a language show that language's not-found page (with the site's root layout).
export default function CatchAll() {
  notFound();
}
