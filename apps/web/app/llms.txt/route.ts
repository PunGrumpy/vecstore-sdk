import { getLLMText } from "@/lib/get-llm-text";
import { source } from "@/lib/source";

export const revalidate = false;

const handler = async () => {
  const pages = await Promise.all(source.getPages().map(getLLMText));
  return new Response(pages.join("\n\n"), {
    headers: { "Content-Type": "text/plain" },
  });
};

export { handler as GET };
