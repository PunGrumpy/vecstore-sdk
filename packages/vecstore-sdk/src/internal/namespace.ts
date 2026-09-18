import { invalidArgument } from "../errors";
import type { Provider, VecstoreError } from "../errors";

const ENCODING_SEPARATOR = "/";

export const namespaceError = (
  provider: Provider,
  namespace: string
): VecstoreError | undefined =>
  namespace.includes(ENCODING_SEPARATOR)
    ? invalidArgument(
        provider,
        `A namespace cannot contain "${ENCODING_SEPARATOR}" on ${provider}, because the adapter joins the namespace and the id with it when it stores a record. Received "${namespace}".`
      )
    : undefined;
