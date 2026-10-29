import { appStore } from "@/app/store";
import { fetcher } from "lib/utils";
import useSWR, { SWRConfiguration } from "swr";

export const useChatModels = (options?: SWRConfiguration) => {
  return useSWR<
    {
      provider: string;
      hasAPIKey: boolean;
      models: {
        name: string;
        isToolCallUnsupported: boolean;
        isImageInputUnsupported: boolean;
        supportedFileMimeTypes: string[];
      }[];
    }[]
  >("/api/chat/models", fetcher, {
    dedupingInterval: 60_000 * 5,
    revalidateOnFocus: false,
    fallbackData: [],
    onSuccess: (data) => {
      const status = appStore.getState();
      const available = data.flatMap((provider) =>
        provider.models.map((model) => ({
          provider: provider.provider,
          model: model.name,
        })),
      );
      if (!status.chatModel && available[0]) {
        appStore.setState({ chatModel: available[0] });
        return;
      }
      if (
        status.chatModel &&
        !available.some(
          (model) =>
            model.provider === status.chatModel?.provider &&
            model.model === status.chatModel?.model,
        )
      ) {
        appStore.setState({
          chatModel: available[0],
          autoRouting: available.length > 0,
        });
      }
    },
    ...options,
  });
};
