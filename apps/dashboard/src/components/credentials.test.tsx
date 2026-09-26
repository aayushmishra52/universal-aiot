import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CredentialsModal } from "./CredentialsModal";
import * as credApi from "../api/credentials";

vi.mock("../api/credentials", () => ({
  listCredentials: vi.fn(),
  provisionCredentials: vi.fn(),
  revokeCredential: vi.fn(),
}));

const listMock = credApi.listCredentials as unknown as ReturnType<typeof vi.fn>;
const provisionMock = credApi.provisionCredentials as unknown as ReturnType<typeof vi.fn>;
const revokeMock = credApi.revokeCredential as unknown as ReturnType<typeof vi.fn>;

const existing = [
  {
    id: "cred-1",
    clientId: "dc_abcdefghijklmnop",
    label: "rooftop",
    scopes: ["telemetry", "commands"],
    createdAt: Date.now() - 1000,
    lastUsedAt: null,
    revokedAt: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue(existing);
  window.confirm = vi.fn(() => true);
});

describe("CredentialsModal", () => {
  it("lists existing credentials", async () => {
    render(<CredentialsModal deviceId="DEV-1" deviceName="sensor" onClose={() => {}} />);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith("DEV-1"));
    expect(await screen.findByText("dc_abcdefghijklmnop")).toBeInTheDocument();
    expect(screen.getByText("Revoke")).toBeInTheDocument();
  });

  it("shows the issued secret exactly once after provisioning", async () => {
    provisionMock.mockResolvedValue({
      id: "cred-2",
      clientId: "dc_qrstuvwxyz123456",
      secret: "s3cr3t-once",
      label: "new",
      scopes: ["telemetry"],
      createdAt: Date.now(),
      lastUsedAt: null,
      revokedAt: null,
    });
    render(<CredentialsModal deviceId="DEV-1" deviceName="sensor" onClose={() => {}} />);
    await screen.findByText("dc_abcdefghijklmnop");

    fireEvent.click(screen.getByText("+ Provision credential"));
    await waitFor(() => expect(provisionMock).toHaveBeenCalled());

    // Secret shown once with copy + download affordances.
    expect(screen.getByText("s3cr3t-once")).toBeInTheDocument();
    expect(screen.getByText("dc_qrstuvwxyz123456")).toBeInTheDocument();
    expect(screen.getByText("⤓ Download .env")).toBeInTheDocument();
    expect(screen.getByText("⤓ Download JSON")).toBeInTheDocument();

    // Dismissing the once-view removes the secret from the DOM.
    fireEvent.click(screen.getByText("I've saved it — done"));
    await waitFor(() =>
      expect(screen.queryByText("s3cr3t-once")).not.toBeInTheDocument(),
    );
  });

  it("revokes a credential after confirmation", async () => {
    revokeMock.mockResolvedValue(undefined);
    render(<CredentialsModal deviceId="DEV-1" deviceName="sensor" onClose={() => {}} />);
    await screen.findByText("dc_abcdefghijklmnop");

    fireEvent.click(screen.getByText("Revoke"));
    await waitFor(() =>
      expect(revokeMock).toHaveBeenCalledWith("DEV-1", "cred-1"),
    );
  });
});
