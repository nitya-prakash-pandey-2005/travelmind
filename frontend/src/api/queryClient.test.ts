import { MutationObserver } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { ME_OWNER } from "../test/fixtures";
import { ApiError } from "./client";
import { qk } from "./queries";
import { createQueryClient, setUnauthorizedHandler } from "./queryClient";

afterEach(() => setUnauthorizedHandler(null));

test("a 401 from any data query signs the user out and calls the handler", async () => {
  const client = createQueryClient({ retry: false });
  const handler = vi.fn();
  setUnauthorizedHandler(handler);
  client.setQueryData(qk.me, ME_OWNER);

  await expect(
    client.fetchQuery({
      queryKey: ["team"],
      queryFn: () => Promise.reject(new ApiError(401, "Your session has expired. Please sign in again.")),
    }),
  ).rejects.toBeInstanceOf(ApiError);

  expect(handler).toHaveBeenCalledOnce();
  expect(client.getQueryData(qk.me)).toBeNull();
});

test("sign-in style mutations can opt out of the redirect", async () => {
  const client = createQueryClient({ retry: false });
  const handler = vi.fn();
  setUnauthorizedHandler(handler);
  const observer = new MutationObserver(client, {
    mutationFn: () => Promise.reject(new ApiError(401, "Invalid email or password.")),
    meta: { skipAuthRedirect: true },
  });
  await expect(observer.mutate()).rejects.toBeInstanceOf(ApiError);
  expect(handler).not.toHaveBeenCalled();
});

test("other errors do not sign the user out", async () => {
  const client = createQueryClient({ retry: false });
  const handler = vi.fn();
  setUnauthorizedHandler(handler);
  client.setQueryData(qk.me, ME_OWNER);
  await expect(
    client.fetchQuery({ queryKey: ["team"], queryFn: () => Promise.reject(new ApiError(500, "Boom")) }),
  ).rejects.toBeInstanceOf(ApiError);
  expect(handler).not.toHaveBeenCalled();
  expect(client.getQueryData(qk.me)).toEqual(ME_OWNER);
});
