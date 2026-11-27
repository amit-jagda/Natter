import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  icon?: React.ReactNode;
  className?: string;
  dropdownClassName?: string;
  disabled?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  icon,
  className = "",
  dropdownClassName = "",
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full px-3.5 py-2.5 rounded-xl bg-[#fcfaff] dark:bg-white/5 border border-[#e6e0f5] dark:border-[#2b2347] text-xs sm:text-sm font-semibold text-[#150f26] dark:text-white hover:border-[#7c3aed] flex items-center justify-between cursor-pointer transition-colors focus:outline-none focus:border-[#7c3aed] disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <div className="flex items-center gap-2 truncate">
          {icon && <span className="shrink-0 text-[#7c3aed]">{icon}</span>}
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-[#a29bc2] shrink-0 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute left-0 right-0 mt-1.5 z-50 rounded-2xl bg-white dark:bg-[#181329] border border-[#e6e0f5] dark:border-[#2b2347] shadow-xl p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-100 max-h-60 overflow-y-auto ${dropdownClassName}`}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 rounded-xl text-left text-xs sm:text-sm font-medium flex items-center justify-between transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-purple-50 dark:bg-purple-950/40 text-[#7c3aed] font-bold"
                    : "text-[#150f26] dark:text-white hover:bg-slate-50 dark:hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                  <span className="truncate">{opt.label}</span>
                </div>
                {isSelected && <Check className="h-4 w-4 text-[#7c3aed] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CustomSelect;
