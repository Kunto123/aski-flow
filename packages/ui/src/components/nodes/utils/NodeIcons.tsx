import { FC } from "react";
import {
  AiOutlineEdit,
  AiOutlineMergeCells,
  AiOutlineSearch,
} from "react-icons/ai";
import { BiMask } from "react-icons/bi";
import { BsFiletypeJson, BsListTask, BsRegex } from "react-icons/bs";
import { GiPerspectiveDiceSix } from "react-icons/gi";
import {
  FaCamera,
  FaRecordVinyl,
  FaUserCircle,
  FaRobot,
  FaPlay,
  FaLink,
  FaFilm,
  FaImage,
  FaEye,
  FaAws,
  FaProjectDiagram,
  FaGoogle,
  FaRandom,
} from "react-icons/fa";
import { SiZapier } from "react-icons/si";
import { FiFilter, FiRepeat } from "react-icons/fi";
import {
  MdHttp,
  MdLoop,
  MdOutlineBolt,
  MdOutlineCrop,
  MdSwapHoriz,
} from "react-icons/md";
import { TbHttpGet } from "react-icons/tb";

const ICON_MAP: { [key: string]: FC } = {
  FaUserCircle: FaUserCircle,
  FaRobot: FaRobot,
  FaPlay: FaPlay,
  FaLink: FaLink,
  FaFilm: FaFilm,
  FaImage: FaImage,
  FaEye: FaEye,
  FiFilter: FiFilter,
  AiOutlineSearch: AiOutlineSearch,
  BsRegex: BsRegex,
  MdSwapHoriz: MdSwapHoriz,
  AiOutlineEdit: AiOutlineEdit,
  AiOutlineMergeCells: AiOutlineMergeCells,
  BsJson: BsFiletypeJson,
  FaAws: FaAws,
  TbHttpGet: TbHttpGet,
  MdHttp: MdHttp,
  MdOutlineBolt: MdOutlineBolt,
  MdOutlineCrop: MdOutlineCrop,
  BiMask: BiMask,
  FaProjectDiagram: FaProjectDiagram,
  FiRepeat: FiRepeat,
  BsListTask: BsListTask,
  SubflowLoop: () => (
    <div>
      <FaProjectDiagram className="" />
      <MdLoop className="absolute left-11 top-9" />
    </div>
  ),
  AIFlowLogo: () => <img src="./logo.svg" alt="hi" className="w-full" />,
  AirTableLogo: () => (
    <img src="./img/airtable-logo.svg" alt="airtable" className="w-full" />
  ),
  FaGoogle,
  ZapierIcon: () => <SiZapier />,
  MakeIcon: () => (
    <img src="./img/make-logo.svg" alt="make" className="w-full" />
  ),
  GeminiIcon: () => (
    <img
      src="./img/gemini-logo.png"
      alt="gemini"
      className="w-full rounded-lg"
    />
  ),
  FaRandom,
  GiPerspectiveDiceSix,
  FaCamera,
  FaRecordVinyl,
};

export const getIconComponent = (type: string) => ICON_MAP[type];
