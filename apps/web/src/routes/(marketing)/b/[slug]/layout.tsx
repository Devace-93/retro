import { component$, Slot } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import { fetchBoard } from "../../../../lib/board.server";

/**
 * Loads the public board once for /b/[slug] and /b/[slug]/changelog. The
 * marketing chrome (nav + footer) comes from the parent (marketing) layout.
 */
export const useBoard = routeLoader$(async ({ params, status }) => {
  const result = await fetchBoard(params.slug);
  if (!result.ok) status(result.status === 503 ? 503 : 404);
  return result;
});

export default component$(() => <Slot />);
