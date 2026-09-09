import { BrandMenu } from "@/components/brand-menu";
import { VecstoreIcon } from "@/components/icons/vecstore";

export const Logo = () => (
  <BrandMenu>
    <span className="text-gray-1000 inline-flex items-center gap-2">
      <VecstoreIcon className="size-4" />
      <span className="font-medium tracking-tight">VecStore SDK</span>
    </span>
  </BrandMenu>
);
