"use server";

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase-server";

export async function signIn(form: FormData): Promise<void> {
  const supabase = createSupabaseServer();
  if (!supabase) redirect("/login?error=unconfigured");
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
  });
  redirect(error ? "/login?error=invalid" : "/");
}

export async function signOut(): Promise<void> {
  const supabase = createSupabaseServer();
  await supabase?.auth.signOut();
  redirect("/login");
}
