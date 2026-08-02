import { createServiceClient } from "@/lib/supabase/service";

// Dream's own agency identity block — used to render letterheads, mandate
// signature lines, PPRA disclaimers, and any generated document's header.
//
// Source of truth for the fields that already live on the `agency` table
// (name, ffc_no, phone, email, address) is that row (WHERE is_dream = true).
// Two extra fields not on the agency table yet — principal_name and
// logo_path — are kept as constants below. When we build /settings/agency,
// they graduate to columns; until then, "rebrand" = edit these two lines.
//
// A single source of truth for the logo path is intentional: every generated
// document pulls its letterhead image from LOGO_PATH; swap the file at that
// public URL and every future document uses the new logo. No template edits.

const DREAM_PRINCIPAL_NAME = "Bronwyn Eyre";
const DREAM_LOGO_PATH = "/brand/dream-knysna-logo.png";
const DREAM_LOGO_PATH_2X = "/brand/dream-knysna-logo@2x.png";

// PPRA-mandated tag on every marketing / listing artifact. Referenced in the
// footer of generated docs so Bronwyn's compliance line is consistent.
const PPRA_LINE =
  "Dream Knysna (Pty) Ltd is a registered estate agency in terms of the Property Practitioners Act, 22 of 2019.";

export type AgencyIdentity = {
  id: string;
  name: string;
  principalName: string;
  ffcNo: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoPath: string;
  logoPath2x: string;
  ppraLine: string;
};

const FALLBACK: AgencyIdentity = {
  id: "",
  name: "Dream Knysna (Pty) Ltd",
  principalName: DREAM_PRINCIPAL_NAME,
  ffcNo: "2026-15016210000",
  phone: "+27 44 382 0362",
  email: "info@dreamknysna.co.za",
  address: "2 Gray Street, Knysna, 6571",
  logoPath: DREAM_LOGO_PATH,
  logoPath2x: DREAM_LOGO_PATH_2X,
  ppraLine: PPRA_LINE,
};

export async function getDreamAgency(): Promise<AgencyIdentity> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("agency")
      .select("id, name, ffc_no, phone, email, address")
      .eq("is_dream", true)
      .maybeSingle();
    if (error || !data) return FALLBACK;
    return {
      id: data.id,
      name: data.name ?? FALLBACK.name,
      principalName: DREAM_PRINCIPAL_NAME,
      ffcNo: data.ffc_no,
      phone: data.phone,
      email: data.email,
      address: data.address,
      logoPath: DREAM_LOGO_PATH,
      logoPath2x: DREAM_LOGO_PATH_2X,
      ppraLine: PPRA_LINE,
    };
  } catch {
    return FALLBACK;
  }
}
