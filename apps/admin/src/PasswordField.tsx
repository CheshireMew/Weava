import { useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function PasswordField({label,id,...props}:{label:string}&Omit<InputHTMLAttributes<HTMLInputElement>,'type'>) {
  const generatedId=useId(),inputId=id??generatedId;
  const [visible,setVisible]=useState(false);
  const action=(visible?'隐藏':'显示')+label;
  return <div className="password-field">
    <label htmlFor={inputId}>{label}</label>
    <div className="password-input">
      <input {...props} id={inputId} type={visible?'text':'password'}/>
      <button type="button" aria-label={action} title={action} aria-controls={inputId} aria-pressed={visible}
        disabled={props.disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>setVisible(value=>!value)}>
        {visible?<EyeOff size={18} aria-hidden="true"/>:<Eye size={18} aria-hidden="true"/>}
      </button>
    </div>
  </div>;
}
