import { Adapters } from "@/components/sections/adapters";
import { Core } from "@/components/sections/core";
import { Guides } from "@/components/sections/guides";
import { Hero } from "@/components/sections/hero";
import { Highlights } from "@/components/sections/highlights";
import { Pitch } from "@/components/sections/pitch";
import { Stats } from "@/components/sections/stats";

const Home = () => (
  <>
    <Hero />
    <Stats />
    <Pitch />
    <Highlights />
    <Core />
    <Adapters />
    <Guides />
  </>
);

export default Home;
