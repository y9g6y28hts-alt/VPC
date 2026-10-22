import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = ["/ingresar", "/auth"];

/**
 * Renueva la sesión de Supabase (cookies) y redirige al ingreso si no hay
 * sesión. Es una verificación optimista: la autorización real se hace en el
 * servidor (getContext) y en la base de datos (RLS y funciones).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!data.user && !isPublic) {
    const to = request.nextUrl.clone();
    to.pathname = "/ingresar";
    to.search = path !== "/" ? `?siguiente=${encodeURIComponent(path + request.nextUrl.search)}` : "";
    return NextResponse.redirect(to);
  }
  if (data.user && path === "/ingresar") {
    const to = request.nextUrl.clone();
    to.pathname = "/";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|fonts/|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
