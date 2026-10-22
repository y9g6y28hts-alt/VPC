import { redirect } from "next/navigation";
import { NAV } from "@/components/shell/nav";
import { requireContext } from "@/server/auth/context";

export default async function Home() {
  const ctx = await requireContext();
  const first = NAV.find((i) => ctx.perms.any(...i.anyOf));
  redirect(first?.href ?? "/sin-acceso");
}
