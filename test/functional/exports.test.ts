import { describe, expect, it } from "@jest/globals";
import { Command, Cluster, ReplyError } from "../../lib";

describe("exports", () => {
  describe(".Command", () => {
    it("should be `Command`", () => {
      expect(Command).toBe(require("../../lib/Command").default);
    });
  });

  describe(".Cluster", () => {
    it("should be `Cluster`", () => {
      expect(Cluster).toBe(require("../../lib/cluster").default);
    });
  });

  describe(".ReplyError", () => {
    it("should be `ReplyError`", () => {
      expect(ReplyError).toBe(require("redis-errors").ReplyError);
    });
  });
});
