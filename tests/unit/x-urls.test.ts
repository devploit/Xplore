import { describe, expect, it } from "vitest";
import { parseGraphqlUrl } from "@/shared/x-urls";

describe("parseGraphqlUrl", () => {
  it("parses an absolute GET GraphQL URL with features and fieldToggles", () => {
    const url =
      "https://x.com/i/api/graphql/p9sOCF1tLh4KfPWtt4TNGQ/UserTweets?variables=%7B%22userId%22%3A%221%22%7D" +
      "&features=%7B%22a%22%3Atrue%2C%22b%22%3Afalse%7D&fieldToggles=%7B%22withArticlePlainText%22%3Afalse%7D";
    expect(parseGraphqlUrl(url)).toEqual({
      queryId: "p9sOCF1tLh4KfPWtt4TNGQ",
      op: "UserTweets",
      features: { a: true, b: false },
      fieldToggles: { withArticlePlainText: false },
    });
  });

  it("parses a relative POST URL without query parameters", () => {
    expect(parseGraphqlUrl("/i/api/graphql/lI07N6Otwv1PhnEgXILM7A/FavoriteTweet")).toEqual({
      queryId: "lI07N6Otwv1PhnEgXILM7A",
      op: "FavoriteTweet",
    });
  });

  it("accepts query ids with dashes", () => {
    expect(parseGraphqlUrl("/i/api/graphql/-5OaAZ4pICdvoQhPJXsCvg/ListMembers")?.queryId).toBe("-5OaAZ4pICdvoQhPJXsCvg");
  });

  it("returns null for non GraphQL URLs", () => {
    expect(parseGraphqlUrl("https://x.com/i/api/1.1/jot/client_event.json")).toBeNull();
    expect(parseGraphqlUrl("https://x.com/home")).toBeNull();
  });

  it("ignores a features parameter that is not JSON", () => {
    expect(parseGraphqlUrl("/i/api/graphql/abc/Op?features=nope")).toEqual({ queryId: "abc", op: "Op" });
  });
});
