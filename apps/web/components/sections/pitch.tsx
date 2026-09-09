import { ProviderMark } from "@/components/landing/provider-marks";
import { Container } from "@/components/sections/container";
import { demoProviders } from "@/lib/landing-content";

export const Pitch = () => (
  <Container>
    <div className="flex flex-col items-center py-24 text-center">
      <h2 className="text-heading-40 max-w-3xl text-balance">
        The provider-agnostic vector toolkit
      </h2>
      <p className="text-copy-18 mt-6 max-w-2xl text-balance text-gray-900">
        Vector databases agree on the verbs and disagree on everything else.
        VecStore SDK keeps the verbs and hides the rest, so switching providers
        changes one import and one config object.
      </p>
      <ul className="mt-12 flex flex-wrap items-center justify-center gap-10">
        {demoProviders.map((provider) => (
          <li
            className="hover:text-gray-1000 text-gray-800 transition-colors"
            key={provider.id}
            title={provider.label}
          >
            <ProviderMark className="size-14" id={provider.id} />
            <span className="sr-only">{provider.label}</span>
          </li>
        ))}
      </ul>
    </div>
  </Container>
);
