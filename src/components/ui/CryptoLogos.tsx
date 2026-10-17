import React from "react";

export function ZcashLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="16" cy="16" r="16" fill="#F4B728" />
      {/* Official Zcash Z with vertical center lines */}
      <rect x="14.6" y="5.5" width="2.8" height="21" fill="#231F20" rx="0.5" />
      <path
        d="M9.5 9.5H22.5V12.8L13.8 20.2H22.5V23.5H9.5V20.2L18.2 12.8H9.5V9.5Z"
        fill="#231F20"
      />
    </svg>
  );
}

export function UsdcLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path
        d="M16 6C10.48 6 6 10.48 6 16C6 21.52 10.48 26 16 26C21.52 26 26 21.52 26 16C26 10.48 21.52 6 16 6ZM16 7.8C20.52 7.8 24.2 11.48 24.2 16C24.2 20.52 20.52 24.2 16 24.2C11.48 24.2 7.8 20.52 7.8 16C7.8 11.48 11.48 7.8 16 7.8Z"
        fill="white"
        fillOpacity="0.3"
      />
      <path
        d="M17.6 14.8C17.6 13.9 16.9 13.3 15.6 13.3H13.8V16.3H15.6C16.9 16.3 17.6 15.7 17.6 14.8ZM17.9 18.5C17.9 17.6 17.1 17 15.8 17H13.8V20H15.8C17.1 20 17.9 19.4 17.9 18.5ZM16.3 10.8V12H17.8C19.7 12 20.8 13.1 20.8 14.7C20.8 15.9 20.2 16.8 19.1 17.2C20.4 17.7 21.1 18.7 21.1 20.1C21.1 21.8 19.8 23 17.8 23H16.3V24.2H14.7V23H11V21.4H13.8V12H11V10.4H14.7V10.8H16.3Z"
        fill="white"
      />
    </svg>
  );
}

export function UsdtLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="16" cy="16" r="16" fill="#26A17B" />
      <path
        d="M17.9 17.1C17.7 17.1 16.9 17.2 16 17.2C15.1 17.2 14.3 17.1 14.1 17.1C11.5 17 9.4 16.5 9.4 15.8C9.4 15.2 11.5 14.6 14.1 14.5C14.3 14.5 15.1 14.4 16 14.4C16.9 14.4 17.7 14.5 17.9 14.5C20.5 14.6 22.6 15.2 22.6 15.8C22.6 16.5 20.5 17 17.9 17.1ZM17.9 13.4V11.2H23.5V8.5H8.5V11.2H14.1V13.4C10.7 13.6 8 14.4 8 15.8C8 17.2 10.7 18 14.1 18.2V24.5H17.9V18.2C21.3 18 24 17.2 24 15.8C24 14.4 21.3 13.6 17.9 13.4Z"
        fill="white"
      />
    </svg>
  );
}

export function EthLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      <g fill="#FFFFFF">
        <path d="M16 5V13.8L22.5 16.8L16 5Z" fillOpacity="0.8" />
        <path d="M16 5L9.5 16.8L16 13.8V5Z" />
        <path d="M16 20.3V27L22.5 18L16 20.3Z" fillOpacity="0.8" />
        <path d="M16 27V20.3L9.5 18L16 27Z" />
        <path d="M16 19.1L22.5 15.6L16 12.6V19.1Z" fillOpacity="0.6" />
        <path d="M9.5 15.6L16 19.1V12.6L9.5 15.6Z" fillOpacity="0.4" />
      </g>
    </svg>
  );
}

export function BaseLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="16" cy="16" r="16" fill="#0052FF" />
      <circle cx="16" cy="16" r="8" fill="white" />
    </svg>
  );
}

export function ArbitrumLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="16" cy="16" r="16" fill="#28A0F0" />
      <path
        d="M19.8 10L16 16.5L13.8 12.7L16.2 8.5H11.5L8 14.6L10.3 18.6L16 8.8L21.7 18.6L24 14.6L19.8 10Z"
        fill="white"
      />
      <path
        d="M16 17.5L12.5 23.5H16.8L18.8 20L16 17.5Z"
        fill="white"
        fillOpacity="0.8"
      />
      <path d="M19.5 23.5H24L20.5 17.5L19.5 23.5Z" fill="white" />
    </svg>
  );
}
