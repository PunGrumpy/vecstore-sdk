import { Container } from "@/components/sections/container";
import { highlights } from "@/lib/landing-content";

export const Highlights = () => (
  <Container>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {highlights.map((item) => (
        <div
          className="bg-background-100 rounded-lg border border-gray-200 p-8 shadow-sm"
          key={item.title}
        >
          <h3 className="text-heading-20 text-gray-1000">{item.title}</h3>
          <p className="text-copy-16 mt-2 text-gray-900">{item.body}</p>
        </div>
      ))}
    </div>
  </Container>
);
