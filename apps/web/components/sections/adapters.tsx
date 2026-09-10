import { VecstoreIcon } from "@/components/icons/vecstore";
import { CopyCommand } from "@/components/landing/copy-command";
import { ProviderIcon } from "@/components/provider-icon";
import { Container } from "@/components/sections/container";
import { adapters } from "@/lib/landing-content";
import { cn } from "@/lib/utils";

export const Adapters = () => (
  <Container>
    <div className="grid grid-cols-1 gap-4 py-24 lg:grid-cols-[1fr_2fr]">
      <div className="lg:pr-12">
        <h2 className="text-heading-32 text-gray-1000">
          Bring your own client
        </h2>
        <p className="text-copy-16 mt-4 text-gray-900">
          Provider SDKs are optional peer dependencies. Install only the one you
          use and the adapter imports nothing else.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {adapters.map((adapter) => (
          <div
            className={cn(
              "bg-background-100 flex flex-col gap-4 rounded-lg border border-gray-200 p-8 shadow-sm",
              adapter.mark === "vecstore" && "md:col-span-2"
            )}
            key={adapter.title}
          >
            <h3 className="text-gray-1000 flex items-center gap-2 font-mono text-[16px] leading-5">
              {adapter.mark === "vecstore" ? (
                <VecstoreIcon className="size-4" />
              ) : (
                <ProviderIcon className="size-4" id={adapter.mark} />
              )}
              {adapter.title}
            </h3>
            <p className="text-copy-16 text-gray-900">{adapter.body}</p>
            <CopyCommand
              className="mt-auto h-11 w-full text-[12px]"
              command={adapter.command}
            />
          </div>
        ))}
      </div>
    </div>
  </Container>
);
