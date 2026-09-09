import { Container } from "@/components/sections/container";
import { stats } from "@/lib/landing-content";

export const Stats = () => (
  <Container>
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map((stat) => (
        <div
          className="bg-background-100 rounded-lg border border-gray-200 p-6 shadow-sm"
          key={stat.label}
        >
          <dd className="text-heading-32 text-gray-1000">{stat.value}</dd>
          <dt className="text-label-13-mono mt-2 text-gray-900">
            {stat.label}
          </dt>
        </div>
      ))}
    </dl>
  </Container>
);
