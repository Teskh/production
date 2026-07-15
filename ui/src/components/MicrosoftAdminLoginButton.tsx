import React from 'react';


const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

type Props = {
  returnTo: '/admin' | '/qc' | '/utility/protocols';
  className?: string;
};

const MicrosoftMark: React.FC = () => (
  <span className="grid h-4 w-4 grid-cols-2 gap-0.5" aria-hidden="true">
    <span className="bg-[#f25022]" />
    <span className="bg-[#7fba00]" />
    <span className="bg-[#00a4ef]" />
    <span className="bg-[#ffb900]" />
  </span>
);

const MicrosoftAdminLoginButton: React.FC<Props> = ({ returnTo, className }) => {
  const handleClick = () => {
    const endpoint = `${API_BASE_URL}/api/admin/microsoft/login`;
    const url = new URL(endpoint, window.location.origin);
    url.searchParams.set('next', returnTo);
    window.location.assign(url.toString());
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        className ??
        'inline-flex w-full items-center justify-center gap-3 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50'
      }
    >
      <MicrosoftMark />
      Ingresar con Microsoft
    </button>
  );
};

export default MicrosoftAdminLoginButton;
