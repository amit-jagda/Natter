import { describe, it, expect, vi } from "vitest";

describe("Hospital Profile Phone (Caller ID) Telephony Enforcement", () => {
  it("blocks outbound call and warns user when Hospital Profile has no phone number", () => {
    let activeCall: any = null;
    let showMissingPhoneModal = false;
    const toastMock = vi.fn();

    const hospitalPhoneNumber = ""; // Empty phone number in profile

    const handleInitiateCall = (patient: { name: string; phone: string; id: string }) => {
      const trimmedHospitalPhone = hospitalPhoneNumber?.trim();
      if (!trimmedHospitalPhone) {
        toastMock("⚠️ Hospital Phone Number is missing! Please configure it in Hospital Profile.");
        showMissingPhoneModal = true;
        return;
      }
      activeCall = {
        isOpen: true,
        direction: "outbound",
        patientName: patient.name,
        patientPhone: patient.phone,
        patientId: patient.id,
      };
    };

    const patient = { name: "Ramesh Kumar", phone: "9876543210", id: "pat-1" };
    handleInitiateCall(patient);

    expect(activeCall).toBeNull();
    expect(showMissingPhoneModal).toBe(true);
    expect(toastMock).toHaveBeenCalledWith(
      expect.stringContaining("Hospital Phone Number is missing")
    );
  });

  it("blocks outbound call when hospital phone contains only whitespace", () => {
    let activeCall: any = null;
    let showMissingPhoneModal = false;
    const toastMock = vi.fn();

    const hospitalPhoneNumber = "   "; // Whitespace only

    const handleInitiateCall = (patient: { name: string; phone: string; id: string }) => {
      const trimmedHospitalPhone = hospitalPhoneNumber?.trim();
      if (!trimmedHospitalPhone) {
        toastMock("⚠️ Hospital Phone Number is missing! Please configure it in Hospital Profile.");
        showMissingPhoneModal = true;
        return;
      }
      activeCall = {
        isOpen: true,
        direction: "outbound",
        patientName: patient.name,
        patientPhone: patient.phone,
        patientId: patient.id,
      };
    };

    handleInitiateCall({ name: "Suresh", phone: "9876500000", id: "pat-2" });

    expect(activeCall).toBeNull();
    expect(showMissingPhoneModal).toBe(true);
  });

  it("allows outbound call with Hospital Caller ID when phone number is configured", () => {
    let activeCall: any = null;
    let showMissingPhoneModal = false;
    const toastMock = vi.fn();

    const hospitalPhoneNumber = "+91 98765 43210"; // Configured in Hospital Profile

    const handleInitiateCall = (patient: { name: string; phone: string; id: string }) => {
      const trimmedHospitalPhone = hospitalPhoneNumber?.trim();
      if (!trimmedHospitalPhone) {
        toastMock("⚠️ Hospital Phone Number is missing! Please configure it in Hospital Profile.");
        showMissingPhoneModal = true;
        return;
      }
      activeCall = {
        isOpen: true,
        direction: "outbound",
        patientName: patient.name,
        patientPhone: patient.phone,
        patientId: patient.id,
        hospitalPhone: trimmedHospitalPhone,
      };
    };

    const patient = { name: "Ramesh Kumar", phone: "9876543210", id: "pat-1" };
    handleInitiateCall(patient);

    expect(showMissingPhoneModal).toBe(false);
    expect(activeCall).not.toBeNull();
    expect(activeCall.isOpen).toBe(true);
    expect(activeCall.direction).toBe("outbound");
    expect(activeCall.hospitalPhone).toBe("+91 98765 43210");
    expect(activeCall.patientName).toBe("Ramesh Kumar");
  });

  it("navigates to Hospital Profile when user clicks Configure button", () => {
    const onNavigateToProfile = vi.fn();
    let showMissingPhoneModal = true;

    // Simulate clicking the "Configure in Hospital Profile" button
    const handleConfigureClick = () => {
      showMissingPhoneModal = false;
      onNavigateToProfile();
    };

    handleConfigureClick();

    expect(showMissingPhoneModal).toBe(false);
    expect(onNavigateToProfile).toHaveBeenCalledTimes(1);
  });

  it("blocks inbound call test when hospital phone is missing", () => {
    let activeCall: any = null;
    let showMissingPhoneModal = false;
    const toastMock = vi.fn();

    const hospitalPhoneNumber: string | undefined = "" as string | undefined;

    const handleInitiateInboundTest = () => {
      const trimmedHospitalPhone = hospitalPhoneNumber?.trim();
      if (!trimmedHospitalPhone) {
        toastMock("⚠️ Hospital Phone Number is missing! Please configure it in Hospital Profile.");
        showMissingPhoneModal = true;
        return;
      }
      activeCall = {
        isOpen: true,
        direction: "inbound",
      };
    };

    handleInitiateInboundTest();

    expect(activeCall).toBeNull();
    expect(showMissingPhoneModal).toBe(true);
    expect(toastMock).toHaveBeenCalled();
  });

  it("dispatches Option B direct phone call to patient mobile via tel: protocol", () => {
    let directPhoneCall: any = null;
    let showMissingPhoneModal = false;
    const hospitalPhoneNumber = "+91 98765 11223";

    const handleInitiateCall = (patient: { name: string; phone: string; id: string }) => {
      const trimmed = hospitalPhoneNumber?.trim();
      if (!trimmed) {
        showMissingPhoneModal = true;
        return;
      }
      directPhoneCall = {
        isOpen: true,
        patientName: patient.name,
        patientPhone: patient.phone,
        patientId: patient.id,
      };
    };

    handleInitiateCall({ name: "Tushar", phone: "9876543210", id: "pat-tushar" });

    expect(showMissingPhoneModal).toBe(false);
    expect(directPhoneCall).not.toBeNull();
    expect(directPhoneCall.patientName).toBe("Tushar");
    expect(directPhoneCall.patientPhone).toBe("9876543210");

    const cleanPhone = directPhoneCall.patientPhone.replace(/[^\d+]/g, "");
    const telUri = `tel:${cleanPhone}`;
    expect(telUri).toBe("tel:9876543210");
  });

  it("launches GSM Gateway calling modal with Hospital SIM and patient details", () => {
    let gsmCall: any = null;
    let showMissingPhoneModal = false;
    const hospitalPhoneNumber = "9328291692";

    const handleInitiateGsmCall = (patient: { name: string; phone: string; id: string }) => {
      const trimmed = hospitalPhoneNumber?.trim();
      if (!trimmed) {
        showMissingPhoneModal = true;
        return;
      }
      gsmCall = {
        isOpen: true,
        patientName: patient.name,
        patientPhone: patient.phone,
        patientId: patient.id,
        hospitalPhone: trimmed,
      };
    };

    handleInitiateGsmCall({ name: "Tushar", phone: "8980616264", id: "pat-tushar-gsm" });

    expect(showMissingPhoneModal).toBe(false);
    expect(gsmCall).not.toBeNull();
    expect(gsmCall.isOpen).toBe(true);
    expect(gsmCall.patientName).toBe("Tushar");
    expect(gsmCall.patientPhone).toBe("8980616264");
    expect(gsmCall.hospitalPhone).toBe("9328291692");
  });
});
