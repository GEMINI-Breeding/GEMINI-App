import React, { useState, useEffect } from 'react';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import { useDataSetters, useDataState } from '../../../DataContext';

function Checklist({ items, onProceed }) {

    const {
        activeStep
    } = useDataState();

    const {
        setActiveStep
    } = useDataSetters();

    const [checkedState, setCheckedState] = useState(
        new Array(items.length).fill(false)
    );

    const handleOnChange = (position) => {
        const updatedCheckedState = checkedState.map((item, index) =>
            index === position ? !item : item
        );

        setCheckedState(updatedCheckedState);
    };

    const allChecked = checkedState.every(Boolean);

    return (
        <div>
            <List>
                {items.map((item, index) => (
                    <ListItem key={index}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={checkedState[index]}
                                    onChange={() => handleOnChange(index)}
                                    color="primary"
                                />
                            }
                            label={item}
                        />
                    </ListItem>
                ))}
            </List>
            <Button
                variant="contained"
                disabled={!allChecked}
                color="primary"
                style={{ marginTop: '20px', backgroundColor: allChecked ? '' : 'grey' }}
                onClick={onProceed}
            >
                Proceed
            </Button>
        </div>
    );
}

export default Checklist;
