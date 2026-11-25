import React, { useState, useEffect } from "react";
import {
  PhoneCall,
  Smartphone,
  Copy,
  Check,
  Building2,
  QrCode,
  MessageSquare,
  ShieldCheck,
  X,
  Sparkles,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";

export interface DirectPhoneCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientName: string;
  patientPhone: string;
  hospitalPhone: string;
  patientId?: string;
  onSwitchToWebRTC?: () => void;
}

export const DirectPhoneCallModal: React.FC<DirectPhoneCallModalProps> = ({
  isOpen,
  onClose,
  patientName,
  patientPhone,
  hospitalPhone,
  patientId,
  onSwitchToWebRTC,
}) => {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [callSessionId, setCallSessionId] = useState<string>("");
  const [whatsappUri, setWhatsappUri] = useState<string>("");

  const cleanPhone = patientPhone.replace(/[^\d+]/g, "");
  const telUri = `tel:${cleanPhone}`;

  useEffect(() => {
    if (!isOpen) return;

    // Dispatch call session to backend
    const registerCallDispatch = async () => {
      try {
        const res = await apiClient.post<any>("/api/v1/telephony/phone-dispatch", {
          patient_name: patientName,
          patient_phone: cleanPhone,
          patient_id: patientId || null,
          hospital_phone: hospitalPhone,
        });
        if (res.call_id) setCallSessionId(res.call_id);
        if (res.whatsapp_uri) setWhatsappUri(res.whatsapp_uri);
      } catch (err) {
        console.warn("Phone dispatch logging notice:", err);
      }
    };

    registerCallDispatch();

    // Trigger native dialer automatically on mobile / supported devices
    try {
      window.location.href = telUri;
    } catch {
      // Ignore if browser prevents auto navigation
    }
  }, [isOpen, cleanPhone]);

  const handleCopyNumber = () => {
    navigator.clipboard.writeText(cleanPhone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleManualDial = () => {
    window.location.href = telUri;
  };

  if (!isOpen) return null;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
    telUri
  )}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-[28px] bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] shadow-2xl overflow-hidden p-6 sm:p-7 space-y-5">
        {/* Header Bar */}
        <div className="flex items-center justify-between pb-3 border-b border-[#e6e0f5] dark:border-[#2b2347]">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
              <Smartphone className="h-3.5 w-3.5" />
              <span>Direct Mobile Phone Calling</span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] dark:text-purple-300 border border-purple-200 dark:border-purple-800">
              GSM / SIM Dial
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#625b7e] hover:text-[#150f26] dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Calling Card: Hospital SIM Number -> Patient Number */}
        <div className="p-4 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] space-y-3">
          <div className="flex items-center justify-between text-xs text-[#625b7e] dark:text-[#a29bc2]">
            <div className="flex items-center gap-1.5 font-medium">
              <Building2 className="h-3.5 w-3.5 text-[#7c3aed]" />
              <span>Hospital Mobile (Caller ID):</span>
            </div>
            <span className="font-mono font-bold text-[#150f26] dark:text-white">
              {hospitalPhone || "Configured in Hospital Profile"}
            </span>
          </div>

          <div className="h-px bg-[#e6e0f5] dark:bg-[#2b2347]" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-purple-100 dark:bg-purple-950/70 text-[#7c3aed] dark:text-purple-300 font-bold grid place-items-center text-sm shrink-0">
                {patientName.charAt(0).toUpperCase() || "P"}
              </div>
              <div>
                <h4 className="font-bold text-sm text-[#150f26] dark:text-white leading-tight">
                  {patientName}
                </h4>
                <p className="text-xs text-[#625b7e] dark:text-[#a29bc2] font-mono mt-0.5 font-semibold">
                  {patientPhone}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopyNumber}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-[#120e1f] border border-[#e6e0f5] dark:border-[#2b2347] text-[#625b7e] hover:text-[#7c3aed] transition-colors cursor-pointer"
              title="Copy patient number"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </div>

        {/* Primary Action Button: Open Dialer / Place Call */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleManualDial}
            className="w-full py-3.5 px-5 rounded-2xl text-sm font-bold bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2.5 transition-all cursor-pointer"
          >
            <PhoneCall className="h-5 w-5 animate-pulse" />
            <span>Open Phone Dialer to Call {patientName}</span>
          </button>
          <p className="text-[11px] text-center text-[#625b7e] dark:text-[#a29bc2]">
            Clicking opens your phone dialer app with patient's number pre-dialed.
          </p>
        </div>

        {/* QR Code Section for Scanning with Hospital Smartphone */}
        <div className="p-4 rounded-2xl bg-[#faf8fe] dark:bg-[#16112a] border border-[#e6e0f5] dark:border-[#2b2347] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-[#7c3aed]" />
              <span className="text-xs font-bold text-[#150f26] dark:text-white">
                Calling from Hospital Mobile?
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowQr(!showQr)}
              className="text-xs font-semibold text-[#7c3aed] hover:underline cursor-pointer"
            >
              {showQr ? "Hide QR Code" : "Show QR Code to Scan"}
            </button>
          </div>

          {showQr ? (
            <div className="pt-2 flex flex-col items-center justify-center gap-2">
              <div className="p-2 bg-white rounded-xl shadow-sm border border-gray-200">
                <img
                  src={qrUrl}
                  alt="Scan to Call on Mobile Phone"
                  className="w-36 h-36 object-contain"
                />
              </div>
              <p className="text-[11px] text-center text-[#625b7e] dark:text-[#a29bc2]">
                Apne hospital mobile ke camera se scan karein — phone me turant dialer khul jayega!
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-[#625b7e] dark:text-[#a29bc2] leading-relaxed">
              Scan with your hospital mobile camera to instantly ring the patient without typing their phone number manually.
            </p>
          )}
        </div>

        {/* Secondary Options: WhatsApp / AI Context */}
        <div className="flex items-center gap-2">
          {whatsappUri && (
            <a
              href={whatsappUri}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2.5 px-3 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <MessageSquare className="h-4 w-4" />
              <span>Send WhatsApp Alert</span>
            </a>
          )}

          {onSwitchToWebRTC && (
            <button
              type="button"
              onClick={onSwitchToWebRTC}
              className="flex-1 py-2.5 px-3 rounded-xl border border-purple-200 dark:border-purple-800/60 bg-purple-50 dark:bg-purple-950/30 text-[#7c3aed] dark:text-purple-300 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-purple-100 transition-colors cursor-pointer"
            >
              <Sparkles className="h-4 w-4" />
              <span>Switch to WebRTC</span>
            </button>
          )}
        </div>

        {/* Footer Session Badge */}
        <div className="flex items-center justify-between text-[11px] text-[#8b84a6] dark:text-[#7a7299] pt-1">
          <div className="flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            <span>Hospital Verified Session: {callSessionId ? callSessionId.slice(0, 12) : "Ready"}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-[#625b7e] hover:text-[#150f26] dark:hover:text-white cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default DirectPhoneCallModal;
