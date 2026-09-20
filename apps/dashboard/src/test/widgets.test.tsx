import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Capability } from "@aiot/contracts";
import { CapabilityWidget } from "../components/widgets";

const noop = () => {};

function sensorCap(over: Partial<Capability> = {}): Capability {
  return {
    id: "temperature",
    name: "Temperature",
    type: "number",
    kind: "sensor",
    unit: "°C",
    precision: 1,
    ...over,
  };
}

function actuatorCap(over: Partial<Capability> = {}): Capability {
  return {
    id: "pump",
    name: "Pump",
    type: "boolean",
    kind: "actuator",
    ...over,
  };
}

describe("CapabilityWidget", () => {
  it("renders a number sensor with value and unit", () => {
    render(
      <CapabilityWidget
        capability={sensorCap()}
        value={23.456}
        onCommand={noop}
        canControl
      />,
    );
    expect(screen.getByText("Temperature")).toBeInTheDocument();
    expect(screen.getByText("23.5")).toBeInTheDocument();
    expect(screen.getByText("°C")).toBeInTheDocument();
  });

  it("calls onCommand with {value:true} when a boolean actuator is toggled on", () => {
    const onCommand = vi.fn();
    render(
      <CapabilityWidget
        capability={actuatorCap()}
        value={false}
        onCommand={onCommand}
        canControl
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith("pump", "set", { value: true });
  });

  it("clamps slider values to min/max before sending", () => {
    const onCommand = vi.fn();
    render(
      <CapabilityWidget
        capability={actuatorCap({
          id: "brightness",
          name: "Brightness",
          type: "integer",
          min: 0,
          max: 100,
        })}
        value={50}
        onCommand={onCommand}
        canControl
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "999" } });
    fireEvent.pointerUp(slider);
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith("brightness", "set", { value: 100 });

    fireEvent.change(slider, { target: { value: "-42" } });
    fireEvent.pointerUp(slider);
    expect(onCommand).toHaveBeenCalledWith("brightness", "set", { value: 0 });
  });

  it("renders enum actuator options from the manifest", () => {
    render(
      <CapabilityWidget
        capability={actuatorCap({
          id: "mode",
          name: "Mode",
          type: "enum",
          enumValues: ["auto", "manual", "eco"],
        })}
        value="auto"
        onCommand={noop}
        canControl
      />,
    );
    const select = screen.getByRole("combobox");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("auto");
    expect(options).toContain("manual");
    expect(options).toContain("eco");
  });

  it("sends the selected enum value on change", () => {
    const onCommand = vi.fn();
    render(
      <CapabilityWidget
        capability={actuatorCap({
          id: "mode",
          name: "Mode",
          type: "enum",
          enumValues: ["auto", "manual"],
        })}
        value="auto"
        onCommand={onCommand}
        canControl
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "manual" } });
    expect(onCommand).toHaveBeenCalledWith("mode", "set", { value: "manual" });
  });

  it("hides controls when canControl is false (viewer role)", () => {
    const onCommand = vi.fn();
    render(
      <CapabilityWidget
        capability={actuatorCap()}
        value={false}
        onCommand={onCommand}
        canControl={false}
      />,
    );
    // No interactive control is rendered for viewers…
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // …only a read-only readout plus the view-only hint.
    expect(screen.getByText("OFF")).toBeInTheDocument();
    expect(screen.getByText(/view-only/i)).toBeInTheDocument();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("renders a read-only badge for status capabilities", () => {
    render(
      <CapabilityWidget
        capability={sensorCap({ id: "conn", name: "Connection", type: "string", kind: "status" })}
        value="stable"
        onCommand={noop}
        canControl
      />,
    );
    expect(screen.getByText("stable")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("renders boolean sensor as ON/OFF pill", () => {
    render(
      <CapabilityWidget
        capability={sensorCap({ id: "motion", name: "Motion", type: "boolean", unit: undefined })}
        value={true}
        onCommand={noop}
        canControl
      />,
    );
    expect(screen.getByText("ON")).toBeInTheDocument();
  });

  it("renders placeholder when no value is available", () => {
    render(
      <CapabilityWidget
        capability={sensorCap()}
        value={undefined}
        onCommand={noop}
        canControl
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
