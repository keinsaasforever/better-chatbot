import { getTranslations } from "next-intl/server";
import { EditShareableLoading } from "@/components/edit-shareable-loading";

export default async function AgentLoading() {
  const t = await getTranslations();

  return (
    <EditShareableLoading
      title={t("Common.editAgent")}
      showGenerateButton={true}
    />
  );
}
